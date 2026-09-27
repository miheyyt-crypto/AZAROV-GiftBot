import {
  games,
  inboundEvents,
  jobs,
  kickAccounts,
  telegramAccounts,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import {
  apply,
  decryptSecret,
  encryptSecret,
  linkKickAccount,
  parseTokenEncryptionKey,
  playCatalogGame,
  provisionUser,
  readGameRound,
} from "@giftbot/domain";
import {
  claimNextJob,
  enqueueJob,
  JOB_TYPES,
  persistInboundAndEnqueue,
  type ClaimedJob,
} from "@giftbot/jobs";
import {
  createMetrics,
  jobCorrelation,
  METRIC_NAMES,
  runWithCorrelation,
} from "@giftbot/observability";
import { eq, sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { close, createWorkerHealthServer, listen } from "./health.js";
import type { WorkerHarness } from "./harness.js";
import { startWorkerHarness } from "./harness.js";
import { executeWorkerJob, processWorkerJob } from "./process-job.js";

let harness: WorkerHarness;

before(async () => {
  harness = await startWorkerHarness();
});

after(async () => {
  await harness.stop();
});

function asClaimed(row: typeof jobs.$inferSelect): ClaimedJob {
  return {
    id: row.id,
    type: row.type,
    owner: row.owner,
    payload: row.payload,
    idempotencyKey: row.idempotencyKey,
    inboundEventId: row.inboundEventId,
    correlationId: row.correlationId,
    retryCount: row.retryCount,
    maxAttempts: row.maxAttempts,
  };
}

async function loadJob(jobId: string): Promise<ClaimedJob> {
  const rows = await harness.db.select().from(jobs).where(eq(jobs.id, jobId));
  const row = rows[0];
  assert.ok(row);
  return asClaimed(row);
}

test("GET /health/ready is live≠ready and does not write", async () => {
  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "kick",
    eventType: "channel.subscription",
    externalEventId: "kick-worker-health-1",
    payload: { id: "kick-worker-health-1" },
  });
  const jobsBefore = (
    await harness.db.select().from(jobs).where(eq(jobs.id, persisted.jobId))
  )[0];
  const server = createWorkerHealthServer({
    checkReady: async () => {
      await harness.db.execute(sql`select 1`);
    },
  });
  await listen(server, "127.0.0.1", 0);
  const address = server.address() as AddressInfo;
  try {
    await new Promise<void>((resolve, reject) => {
      request(
        { host: "127.0.0.1", port: address.port, path: "/health/ready" },
        (res) => {
          res.resume();
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve();
              return;
            }
            reject(new Error(`health status ${res.statusCode}`));
          });
        },
      )
        .on("error", reject)
        .end();
    });
  } finally {
    await close(server);
  }
  assert.equal(jobsBefore?.status, "pending");
  const row = (
    await harness.db.select().from(jobs).where(eq(jobs.id, persisted.jobId))
  )[0];
  assert.equal(row?.status, "pending");
});

test("kick inbound is acked without money or watch-time apply", async () => {
  const user = await provisionUser(harness.db);
  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "kick",
    eventType: "channel.subscription",
    externalEventId: "kick-worker-ack-1",
    payload: { id: "kick-worker-ack-1" },
  });
  await processWorkerJob(harness.db, await loadJob(persisted.jobId));
  const inbound = (
    await harness.db
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.externalEventId, "kick-worker-ack-1"))
  )[0];
  assert.equal(inbound?.processingStatus, "processed");
  const wallet = (
    await harness.db.select().from(wallets).where(eq(wallets.userId, user.userId))
  )[0];
  assert.ok(wallet);
  assert.equal(wallet.balanceMinor, 0n);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.walletId, wallet.id));
  assert.equal(ledger.length, 0);
});

test("worker refuses telegram jobs and cannot claim them", async () => {
  const bot = await persistInboundAndEnqueue(harness.db, {
    provider: "telegram",
    eventType: "message",
    externalEventId: "81001",
    payload: { update_id: 81001, message: { text: "/start" } },
  });
  const telegramJob = await loadJob(bot.jobId);
  await assert.rejects(() => processWorkerJob(harness.db, telegramJob), /telegram/);
  for (let i = 0; i < 16; i += 1) {
    const claimed = await claimNextJob(harness.db, {
      owner: "worker",
      lockedBy: "worker-no-telegram",
    });
    if (!claimed) {
      break;
    }
    assert.notEqual(claimed.id, bot.jobId);
    assert.equal(claimed.owner, "worker");
  }
  const row = (await harness.db.select().from(jobs).where(eq(jobs.id, bot.jobId)))[0];
  assert.equal(row?.status, "pending");
});

test("wallet.reconcile completes without writing the ledger", async () => {
  const user = await provisionUser(harness.db);
  const enqueued = await enqueueJob(harness.db, {
    type: JOB_TYPES.walletReconcile,
    idempotencyKey: `wallet.reconcile:${user.userId}:phase8`,
    payload: { user_id: user.userId },
  });
  await processWorkerJob(harness.db, await loadJob(enqueued.jobId));
  const job = (
    await harness.db.select().from(jobs).where(eq(jobs.id, enqueued.jobId))
  )[0];
  assert.equal(job?.status, "completed");
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.length, 0);
});

test("worker kill after apply yields one money effect on stale reclaim", async () => {
  const user = await provisionUser(harness.db);
  const enqueued = await enqueueJob(harness.db, {
    type: JOB_TYPES.walletApply,
    idempotencyKey: `wallet.apply:${user.userId}:deposit:phase8-kill`,
    payload: {
      user_id: user.userId,
      type: "deposit",
      amount_minor: "1",
    },
  });
  const job = await loadJob(enqueued.jobId);
  await executeWorkerJob(harness.db, job);

  const afterCrash = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(afterCrash.length, 1);
  assert.equal(afterCrash[0]?.amountMinor, 1n);

  await harness.db
    .update(jobs)
    .set({
      status: "processing",
      lockedAt: new Date(Date.now() - 120_000),
      lockedBy: "dead-worker",
    })
    .where(eq(jobs.id, enqueued.jobId));

  let reclaimed: ClaimedJob | undefined;
  for (let i = 0; i < 64; i += 1) {
    const claimed = await claimNextJob(harness.db, {
      owner: "worker",
      lockedBy: "reborn-worker",
      staleLockMs: 60_000,
    });
    if (!claimed) {
      break;
    }
    assert.notEqual(claimed.type.startsWith("telegram."), true);
    if (claimed.id === enqueued.jobId) {
      reclaimed = claimed;
      break;
    }
  }
  assert.ok(reclaimed);
  await processWorkerJob(harness.db, reclaimed);

  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.length, 1);
  const wallet = (
    await harness.db.select().from(wallets).where(eq(wallets.userId, user.userId))
  )[0];
  assert.equal(wallet?.balanceMinor, 1n);
  const completed = (
    await harness.db.select().from(jobs).where(eq(jobs.id, enqueued.jobId))
  )[0];
  assert.equal(completed?.status, "completed");
});

test("kick apply records the event once and does not treat presence as watch", async () => {
  const user = await provisionUser(harness.db);
  const linked = await linkKickAccount(harness.db, {
    userId: user.userId,
    kickUserId: "kick-worker-user-9",
  });
  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "kick",
    eventType: "chat.message.sent",
    externalEventId: "kick-worker-apply-1",
    payload: { user_id: "kick-worker-user-9", watch_seconds: 120 },
  });
  await processWorkerJob(harness.db, await loadJob(persisted.jobId));
  await processWorkerJob(harness.db, await loadJob(persisted.jobId));
  const account = (
    await harness.db
      .select()
      .from(kickAccounts)
      .where(eq(kickAccounts.id, linked.id))
  )[0];
  assert.equal(account?.lastInboundEventId, persisted.eventId);
  const inbound = (
    await harness.db
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.id, persisted.eventId))
  )[0];
  assert.equal(inbound?.processingStatus, "processed");
  const wallet = (
    await harness.db.select().from(wallets).where(eq(wallets.userId, user.userId))
  )[0];
  assert.equal(wallet?.balanceMinor, 0n);
});

test("livestream offline to live enqueues bot send jobs without Telegram API in worker", async () => {
  process.env.PUBLIC_BASE_URL = "https://azarovgift.xyz";
  const user = await provisionUser(harness.db);
  await harness.db.insert(telegramAccounts).values({
    userId: user.userId,
    telegramUserId: 990001n,
    firstName: "Live",
  });
  const persisted = await persistInboundAndEnqueue(harness.db, {
    provider: "kick",
    eventType: "livestream.status.updated",
    externalEventId: "kick-worker-live-1",
    payload: {
      broadcaster: { channel_slug: "azarov7777", username: "azarov7777" },
      is_live: true,
      livestream_id: "worker-stream-1",
    },
  });
  const logs: string[] = [];
  await processWorkerJob(harness.db, await loadJob(persisted.jobId), {
    logger: {
      info(msg, extra) {
        logs.push(msg);
        void extra;
      },
      warn() {},
      error() {},
    },
  });
  const sendJobs = (
    await harness.db.select().from(jobs).where(eq(jobs.type, JOB_TYPES.telegramSendMessage))
  ).filter((row) => row.idempotencyKey.startsWith("kick:stream-start:"));
  assert.equal(sendJobs.length, 1);
  assert.equal(sendJobs[0]?.owner, "bot");
  const payload = sendJobs[0]?.payload as Record<string, unknown>;
  assert.equal(payload.chat_id, 990001);
  assert.equal(payload.disable_web_page_preview, false);
  assert.ok(logs.includes("kick stream state transition"));
  assert.ok(logs.includes("kick stream start broadcast created"));

  const duplicate = await persistInboundAndEnqueue(harness.db, {
    provider: "kick",
    eventType: "livestream.status.updated",
    externalEventId: "kick-worker-live-1b",
    payload: {
      broadcaster: { channel_slug: "azarov7777", username: "azarov7777" },
      is_live: true,
      livestream_id: "worker-stream-1",
    },
  });
  await processWorkerJob(harness.db, await loadJob(duplicate.jobId));
  const sendJobsAfter = (
    await harness.db.select().from(jobs).where(eq(jobs.type, JOB_TYPES.telegramSendMessage))
  ).filter((row) => row.idempotencyKey.startsWith("kick:stream-start:"));
  assert.equal(sendJobsAfter.length, 1);
});

test("kick.refresh_token permanent failure marks needs_reauth without hot-loop", async () => {
  const key = parseTokenEncryptionKey("cd".repeat(32));
  const user = await provisionUser(harness.db);
  const linked = await linkKickAccount(harness.db, {
    userId: user.userId,
    kickUserId: "kick-worker-user-reauth",
    accessTokenEncrypted: encryptSecret(key, "old-access"),
    refreshTokenEncrypted: encryptSecret(key, "old-refresh"),
  });
  const enqueued = await enqueueJob(harness.db, {
    type: JOB_TYPES.kickRefreshToken,
    idempotencyKey: `kick.refresh:reauth:${linked.id}`,
    payload: { kick_account_id: linked.id },
  });
  await processWorkerJob(harness.db, await loadJob(enqueued.jobId), {
    tokenKey: key,
    kickOAuth: {
      async exchangeAuthorizationCode() {
        throw new Error("exchange is not used for refresh");
      },
      async refreshAccessToken() {
        throw new Error("kick token endpoint returned 401");
      },
    },
  });
  const account = (
    await harness.db
      .select()
      .from(kickAccounts)
      .where(eq(kickAccounts.id, linked.id))
  )[0];
  assert.equal(account?.status, "needs_reauth");
  assert.equal(account?.accessTokenEncrypted, null);
  assert.equal(account?.refreshTokenEncrypted, null);
  const completed = (
    await harness.db.select().from(jobs).where(eq(jobs.id, enqueued.jobId))
  )[0];
  assert.equal(completed?.status, "completed");
});

test("kick.refresh_token rotates ciphertext without money", async () => {
  const key = parseTokenEncryptionKey("ef".repeat(32));
  const user = await provisionUser(harness.db);
  const linked = await linkKickAccount(harness.db, {
    userId: user.userId,
    kickUserId: "kick-worker-user-10",
    accessTokenEncrypted: encryptSecret(key, "old-access"),
    refreshTokenEncrypted: encryptSecret(key, "old-refresh"),
  });
  const enqueued = await enqueueJob(harness.db, {
    type: JOB_TYPES.kickRefreshToken,
    idempotencyKey: `kick.refresh:${linked.id}`,
    payload: { kick_account_id: linked.id },
  });
  await processWorkerJob(harness.db, await loadJob(enqueued.jobId), {
    tokenKey: key,
    kickOAuth: {
      async exchangeAuthorizationCode() {
        throw new Error("exchange is not used for refresh");
      },
      async refreshAccessToken() {
        return {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresIn: 3600,
        };
      },
    },
  });
  const account = (
    await harness.db
      .select()
      .from(kickAccounts)
      .where(eq(kickAccounts.id, linked.id))
  )[0];
  assert.ok(account?.accessTokenEncrypted);
  assert.equal(decryptSecret(key, account.accessTokenEncrypted), "new-access");
  assert.equal(
    decryptSecret(key, account.refreshTokenEncrypted ?? ""),
    "new-refresh",
  );
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.length, 0);
});

test("game.settle_async settles once and a read does not settle", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 10n,
    idempotencyKey: `deposit:${user.userId}:worker-game`,
    actorType: "system",
  });
  const [game] = await harness.db
    .insert(games)
    .values({
      slug: `worker-async-${user.userId.slice(0, 8)}`,
      title: "worker async",
      settlementMode: "async",
      status: "active",
      config: { allowedBetMinor: ["3"], prizeMinor: "1" },
    })
    .returning();
  assert.ok(game);
  const accepted = await playCatalogGame(harness.db, {
    gameId: game.id,
    userId: user.userId,
    betAmountMinor: 3n,
    idempotencyKey: `round:${user.userId}:worker-game`,
  });
  const before = await readGameRound(harness.db, {
    roundId: accepted.roundId,
    userId: user.userId,
  });
  assert.equal(before.status, "pending");

  const enqueued = await enqueueJob(harness.db, {
    type: JOB_TYPES.gameSettleAsync,
    idempotencyKey: `game.settle_async:${accepted.roundId}`,
    payload: { round_id: accepted.roundId },
  });
  await processWorkerJob(harness.db, await loadJob(enqueued.jobId));
  await processWorkerJob(harness.db, await loadJob(enqueued.jobId));
  const after = await readGameRound(harness.db, {
    roundId: accepted.roundId,
    userId: user.userId,
  });
  assert.equal(after.status, "settled");
  const wallet = (
    await harness.db.select().from(wallets).where(eq(wallets.userId, user.userId))
  )[0];
  assert.equal(wallet?.balanceMinor, 8n);
});

test("wallet.apply job stamps correlation onto the ledger", async () => {
  const user = await provisionUser(harness.db);
  const enqueued = await enqueueJob(harness.db, {
    type: JOB_TYPES.walletApply,
    idempotencyKey: `wallet.apply:${user.userId}:deposit:trace`,
    payload: {
      user_id: user.userId,
      type: "deposit",
      amount_minor: "3",
    },
    correlationId: "corr-job-tx",
  });
  const job = await loadJob(enqueued.jobId);
  await runWithCorrelation(jobCorrelation(job), () =>
    processWorkerJob(harness.db, job),
  );
  const tx = (
    await harness.db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, user.userId))
  )[0];
  const metadata = tx?.metadata as Record<string, unknown> | null;
  assert.equal(metadata?.correlation_id, "corr-job-tx");
  assert.equal(metadata?.job_id, job.id);
});

test("wallet.reconcile mismatch does not rewrite the balance", async () => {
  const user = await provisionUser(harness.db);
  await harness.db
    .update(wallets)
    .set({ balanceMinor: 11n })
    .where(eq(wallets.userId, user.userId));
  const enqueued = await enqueueJob(harness.db, {
    type: JOB_TYPES.walletReconcile,
    idempotencyKey: `wallet.reconcile:${user.userId}:mismatch`,
    payload: { user_id: user.userId },
  });
  const metrics = createMetrics();
  const job = await loadJob(enqueued.jobId);
  await assert.rejects(
    () => processWorkerJob(harness.db, job, { metrics }),
    /wallet reconcile mismatch/,
  );
  const wallet = (
    await harness.db.select().from(wallets).where(eq(wallets.userId, user.userId))
  )[0];
  assert.equal(wallet?.balanceMinor, 11n);
  assert.equal(metrics.snapshot()[METRIC_NAMES.reconcileMismatch], 1);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.length, 0);
});

test("referral_contest.finalize job requires contest_id", async () => {
  await assert.rejects(
    () =>
      executeWorkerJob(harness.db, {
        id: "00000000-0000-4000-8000-000000000099",
        type: JOB_TYPES.referralContestFinalize,
        owner: "worker",
        payload: {},
        idempotencyKey: "contest-missing-id",
        inboundEventId: null,
        correlationId: null,
        retryCount: 0,
        maxAttempts: 8,
      }),
    /contest_id is required/,
  );
});
