import { kickAccounts } from "@giftbot/db/schema";
import {
  apply,
  applyKickInboundEvent,
  asBigInt,
  decryptSecret,
  encryptSecret,
  finalizeKickStreamSession,
  drawGiveaway,
  finalizeReferralContest,
  finishRollsSpin,
  lockAndSettleRollsRound,
  reconcileAllWallets,
  reconcileWallet,
  settleAsyncRound,
  settleFromCatalog,
  type GiftbotDb,
  type KickOAuthClient,
  type WalletTransactionType,
} from "@giftbot/domain";
import {
  completeJob,
  JOB_TYPES,
  type ClaimedJob,
} from "@giftbot/jobs";
import {
  METRIC_NAMES,
  type Metrics,
  type StructuredLogger,
} from "@giftbot/observability";
import { eq } from "drizzle-orm";

const WALLET_APPLY_TYPES = new Set<WalletTransactionType>([
  "deposit",
  "reward",
  "referral_reward",
  "purchase",
  "bet",
  "prize",
  "refund",
  "admin_adjustment",
  "reversal",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function inboundEventIdOf(payload: unknown): string {
  const id = asRecord(payload)?.inbound_event_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("inbound_event_id is required");
  }
  return id;
}

function roundIdOf(payload: unknown): string {
  const id = asRecord(payload)?.round_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("round_id is required");
  }
  return id;
}

function giveawayIdOf(payload: unknown): string {
  const id = asRecord(payload)?.giveaway_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("giveaway_id is required");
  }
  return id;
}

function contestIdOf(payload: unknown): string {
  const id = asRecord(payload)?.contest_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("contest_id is required");
  }
  return id;
}

function userIdOf(payload: unknown): string {
  const id = asRecord(payload)?.user_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("user_id is required");
  }
  return id;
}

function readWalletApply(payload: unknown): {
  userId: string;
  type: WalletTransactionType;
  amountMinor: bigint;
} {
  const row = asRecord(payload);
  const userId = userIdOf(payload);
  const type = row?.type;
  const amount = row?.amount_minor;
  if (typeof type !== "string" || !WALLET_APPLY_TYPES.has(type as WalletTransactionType)) {
    throw new Error("wallet.apply type is invalid");
  }
  if (typeof amount !== "string" && typeof amount !== "number") {
    throw new Error("wallet.apply amount_minor is required");
  }
  return {
    userId,
    type: type as WalletTransactionType,
    amountMinor: asBigInt(amount),
  };
}

export type WorkerJobDeps = {
  kickOAuth?: KickOAuthClient;
  tokenKey?: Buffer;
  metrics?: Metrics;
  logger?: StructuredLogger;
};

async function processKickInbound(
  db: GiftbotDb,
  job: ClaimedJob,
  deps: WorkerJobDeps,
): Promise<void> {
  const inboundEventId = inboundEventIdOf(job.payload);
  const result = await applyKickInboundEvent(db, inboundEventId);
  const livestream = result.livestream;
  if (!livestream || result.replayed) {
    return;
  }
  deps.logger?.info("kick stream state transition", {
    previous: livestream.previous,
    current: livestream.current,
    transition: livestream.transition,
    sessionId: livestream.sessionId,
    providerStreamId: livestream.providerStreamId,
    inboundEventId,
  });
  if (livestream.transition === "offline_to_live") {
    deps.logger?.info("kick stream start broadcast created", {
      sessionId: livestream.sessionId,
      providerStreamId: livestream.providerStreamId,
      recipientCount: livestream.broadcastRecipientCount ?? 0,
      inboundEventId,
    });
  }
}

async function processKickFinalizeStream(
  db: GiftbotDb,
  job: ClaimedJob,
): Promise<void> {
  const streamSessionId = asRecord(job.payload)?.stream_session_id;
  if (typeof streamSessionId !== "string" || streamSessionId.length === 0) {
    throw new Error("stream_session_id is required");
  }
  await finalizeKickStreamSession(db, streamSessionId);
}

function isPermanentKickTokenFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /kick token endpoint returned (400|401|403)\b/.test(message);
}

async function processKickRefresh(
  db: GiftbotDb,
  job: ClaimedJob,
  deps: WorkerJobDeps,
): Promise<void> {
  if (!deps.kickOAuth || !deps.tokenKey) {
    throw new Error("kick oauth client is not configured");
  }
  const accountId = asRecord(job.payload)?.kick_account_id;
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("kick_account_id is required");
  }
  const rows = await db
    .select()
    .from(kickAccounts)
    .where(eq(kickAccounts.id, accountId))
    .limit(1);
  const account = rows[0];
  if (!account?.refreshTokenEncrypted) {
    throw new Error("kick refresh token is missing");
  }
  let tokens;
  try {
    tokens = await deps.kickOAuth.refreshAccessToken({
      refreshToken: decryptSecret(deps.tokenKey, account.refreshTokenEncrypted),
    });
  } catch (error) {
    if (isPermanentKickTokenFailure(error)) {
      await db
        .update(kickAccounts)
        .set({
          status: "needs_reauth",
          accessTokenEncrypted: null,
          refreshTokenEncrypted: null,
          tokenExpiresAt: null,
        })
        .where(eq(kickAccounts.id, account.id));
      deps.logger?.warn("kick refresh permanently failed; needs_reauth", {
        kickAccountId: account.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      return;
    }
    throw error;
  }
  await db
    .update(kickAccounts)
    .set({
      accessTokenEncrypted: encryptSecret(deps.tokenKey, tokens.accessToken),
      ...(tokens.refreshToken
        ? {
            refreshTokenEncrypted: encryptSecret(
              deps.tokenKey,
              tokens.refreshToken,
            ),
          }
        : {}),
      ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
      tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      lastRefreshedAt: new Date(),
      status: "active",
    })
    .where(eq(kickAccounts.id, account.id));
}

async function processWalletReconcile(
  db: GiftbotDb,
  job: ClaimedJob,
  deps: WorkerJobDeps,
): Promise<void> {
  const rawUserId = asRecord(job.payload)?.user_id;
  const reports =
    typeof rawUserId === "string" && rawUserId.length > 0
      ? [await reconcileWallet(db, rawUserId)]
      : await reconcileAllWallets(db);
  const mismatches = reports.filter((report) => !report.consistent);
  if (mismatches.length === 0) {
    return;
  }
  deps.metrics?.increment(METRIC_NAMES.reconcileMismatch, mismatches.length);
  deps.logger?.error("wallet reconcile mismatch", {
    count: mismatches.length,
    user_ids: mismatches.map((report) => report.userId),
  });
  throw new Error("wallet reconcile mismatch");
}

async function processWalletApply(
  db: GiftbotDb,
  job: ClaimedJob,
): Promise<void> {
  const input = readWalletApply(job.payload);
  await apply(db, {
    userId: input.userId,
    type: input.type,
    amountMinor: input.amountMinor,
    idempotencyKey: job.idempotencyKey,
    actorType: "worker",
  });
}

export async function executeWorkerJob(
  db: GiftbotDb,
  job: ClaimedJob,
  deps: WorkerJobDeps = {},
): Promise<void> {
  if (job.owner !== "worker" || job.type.startsWith("telegram.")) {
    throw new Error("worker refuses telegram and non-worker jobs");
  }

  if (job.type === JOB_TYPES.kickProcessInbound) {
    await processKickInbound(db, job, deps);
    return;
  }
  if (job.type === JOB_TYPES.kickFinalizeStream) {
    await processKickFinalizeStream(db, job);
    return;
  }
  if (job.type === JOB_TYPES.kickRefreshToken) {
    await processKickRefresh(db, job, deps);
    return;
  }
  if (job.type === JOB_TYPES.walletReconcile) {
    await processWalletReconcile(db, job, deps);
    return;
  }
  if (job.type === JOB_TYPES.walletApply) {
    await processWalletApply(db, job);
    return;
  }
  if (job.type === JOB_TYPES.gameSettleAsync) {
    await settleAsyncRound(db, {
      roundId: roundIdOf(job.payload),
      settle: settleFromCatalog,
    });
    return;
  }
  if (job.type === JOB_TYPES.rollsLockRound) {
    await lockAndSettleRollsRound(db, roundIdOf(job.payload));
    return;
  }
  if (job.type === JOB_TYPES.rollsFinishSpin) {
    await finishRollsSpin(db, roundIdOf(job.payload));
    return;
  }
  if (job.type === JOB_TYPES.giveawayDraw) {
    await drawGiveaway(db, giveawayIdOf(job.payload));
    return;
  }
  if (job.type === JOB_TYPES.referralContestFinalize) {
    await finalizeReferralContest(db, contestIdOf(job.payload));
    return;
  }

  throw new Error(`unsupported worker job type: ${job.type}`);
}

export async function processWorkerJob(
  db: GiftbotDb,
  job: ClaimedJob,
  deps: WorkerJobDeps = {},
): Promise<void> {
  await executeWorkerJob(db, job, deps);
  await completeJob(db, job.id);
}
