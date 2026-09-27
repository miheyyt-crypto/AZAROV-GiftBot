import {
  jobs,
  notifications,
  submissionFiles,
  telegramAccounts,
  users,
  wallets,
  welvuraAccountSubmissions,
  welvuraDepositSubmissions,
  welvuraLinks,
  welvuraStageCompletions,
} from "@giftbot/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { writeAuditIn } from "./admin.js";
import { enqueueAdminTelegramNoticesIn } from "./admin-telegram.js";
import { welvuraAdminReviewReplyMarkup } from "./welvura-admin-telegram.js";
import {
  WelvuraAccountNotApprovedError,
  WelvuraAlreadyModeratedError,
  WelvuraInvalidIdError,
  WelvuraInvalidFileError,
  WelvuraRejectionReasonRequiredError,
  WelvuraStageAlreadyCompletedError,
  WelvuraStageLockedError,
  WelvuraSubmissionPendingError,
  NotFoundError,
} from "./errors.js";
import type { SubmissionFileStorage } from "./file-storage.js";
import { asBigInt } from "./money.js";
import { applyIn } from "./wallet.js";

/** Deposits count only from this date inclusive (manual moderation policy). */
export const WELVURA_DEPOSIT_POLICY_FROM = "2026-09-11";

/** Stage 1 (account bind) reward after admin approve. Deposit stages stay in WELVURA_DEPOSIT_STAGES. */
export const WELVURA_ACCOUNT_LINK_REWARD_AZC = 1000n;

export type WelvuraStageDefinition = {
  stageNumber: number;
  requiredDepositRub: bigint;
  rewardAzc: bigint;
};

export const WELVURA_DEPOSIT_STAGES: readonly WelvuraStageDefinition[] = [
  { stageNumber: 1, requiredDepositRub: 100n, rewardAzc: 2_000n },
  { stageNumber: 2, requiredDepositRub: 1_000n, rewardAzc: 3_000n },
  { stageNumber: 3, requiredDepositRub: 2_500n, rewardAzc: 5_000n },
  { stageNumber: 4, requiredDepositRub: 5_000n, rewardAzc: 10_000n },
  { stageNumber: 5, requiredDepositRub: 10_000n, rewardAzc: 20_000n },
  { stageNumber: 6, requiredDepositRub: 20_000n, rewardAzc: 40_000n },
  { stageNumber: 7, requiredDepositRub: 35_000n, rewardAzc: 70_000n },
  { stageNumber: 8, requiredDepositRub: 50_000n, rewardAzc: 100_000n },
  { stageNumber: 9, requiredDepositRub: 100_000n, rewardAzc: 200_000n },
  { stageNumber: 10, requiredDepositRub: 250_000n, rewardAzc: 500_000n },
  { stageNumber: 11, requiredDepositRub: 500_000n, rewardAzc: 1_000_000n },
  { stageNumber: 12, requiredDepositRub: 750_000n, rewardAzc: 1_500_000n },
  { stageNumber: 13, requiredDepositRub: 1_000_000n, rewardAzc: 2_000_000n },
] as const;

export function getWelvuraStage(stageNumber: number): WelvuraStageDefinition {
  const found = WELVURA_DEPOSIT_STAGES.find((s) => s.stageNumber === stageNumber);
  if (!found) {
    throw new NotFoundError("welvura stage not found", "WELVURA_STAGE_NOT_FOUND");
  }
  return found;
}

export function welvuraStageInstruction(amountRub: bigint): string {
  return `Пополни счёт на ${amountRub.toString()} ₽ или больше и пришли скриншот вместе со своим ID. Засчитываются только новые депозиты начиная с 11 сентября. (Депозит учитывается только после подтверждённой привязки аккаунта)`;
}

function normalizeWelvuraId(raw: string): string {
  const id = raw.trim();
  if (!id || id.length > 64 || !/^[A-Za-z0-9_\-.]+$/.test(id)) {
    throw new WelvuraInvalidIdError();
  }
  return id;
}

async function ensureWallet(tx: GiftbotTx, userId: string): Promise<void> {
  const rows = await tx
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  if (!rows[0]) {
    await tx.insert(wallets).values({ userId });
  }
}

async function insertInbox(
  tx: GiftbotTx,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(notifications).values({
    userId: input.userId,
    channel: "inbox",
    type: input.type,
    status: "sent",
    title: input.title,
    body: input.body,
    sentAt: new Date(),
    payload: input.payload,
  });
}

async function enqueueTelegramNotice(
  tx: GiftbotTx,
  input: {
    userId: string;
    idempotencyKey: string;
    text: string;
  },
): Promise<void> {
  const rows = await tx
    .select({ telegramUserId: telegramAccounts.telegramUserId })
    .from(telegramAccounts)
    .where(
      and(
        eq(telegramAccounts.userId, input.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .limit(1);
  const chatId = rows[0]?.telegramUserId;
  if (chatId === undefined || chatId === null) {
    return;
  }
  await tx
    .insert(jobs)
    .values({
      type: "telegram.send_message",
      owner: "bot",
      payload: {
        chat_id: Number(chatId),
        text: input.text,
      },
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({
      target: [jobs.type, jobs.idempotencyKey],
    });
}

function pad2(value: string): string {
  return value.padStart(2, "0");
}

export function formatMoscowDateTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pad2(get("day"))}.${pad2(get("month"))}.${get("year")}, ${pad2(get("hour"))}:${pad2(get("minute"))}:${pad2(get("second"))}`;
}

export function formatWelvuraAdminPendingCaption(input: {
  kind: "account" | "deposit";
  submissionId: string;
  welvuraId: string;
  telegramUserId: string | null;
  username: string | null;
  submittedAt: Date;
  rewardAzc: bigint;
  stageNumber?: number;
  requiredDepositRub?: bigint;
}): string {
  const task =
    input.kind === "account"
      ? "Привязать аккаунт Welvura"
      : `Депозит этап ${String(input.stageNumber)} · ${String(input.requiredDepositRub)} ₽`;
  const usernameLine = input.username
    ? `@${input.username.replace(/^@/, "")}`
    : "—";
  return [
    "🆕 НОВАЯ ЗАЯВКА WELVURA",
    "",
    `📋 Задание: ${task}`,
    `🎁 Награда: ${input.rewardAzc.toString()} монет`,
    "",
    "👤 Пользователь:",
    `Telegram ID: ${input.telegramUserId ?? "—"}`,
    `Username: ${usernameLine}`,
    "",
    "🆔 Welvura ID:",
    input.welvuraId,
    `📅 Дата: ${formatMoscowDateTime(input.submittedAt)}`,
    "",
    "Статус: ⏳ Ожидает проверки",
    `ID заявки: ${input.submissionId}`,
  ].join("\n");
}

async function readSubmitterTelegram(
  tx: GiftbotTx,
  userId: string,
): Promise<{ telegramUserId: string | null; username: string | null }> {
  const rows = await tx
    .select({
      username: telegramAccounts.username,
      telegramUserId: telegramAccounts.telegramUserId,
    })
    .from(telegramAccounts)
    .where(
      and(
        eq(telegramAccounts.userId, userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  return {
    telegramUserId:
      row?.telegramUserId !== undefined && row?.telegramUserId !== null
        ? String(row.telegramUserId)
        : null,
    username: row?.username ?? null,
  };
}

async function notifyAdminsWelvuraSubmission(
  tx: GiftbotTx,
  input: {
    kind: "account" | "deposit";
    submissionId: string;
    userId: string;
    welvuraId: string;
    storageKey: string;
    submittedAt: Date;
    rewardAzc: bigint;
    stageNumber?: number;
    requiredDepositRub?: bigint;
  },
): Promise<void> {
  const who = await readSubmitterTelegram(tx, input.userId);
  const caption = formatWelvuraAdminPendingCaption({
    kind: input.kind,
    submissionId: input.submissionId,
    welvuraId: input.welvuraId,
    telegramUserId: who.telegramUserId,
    username: who.username,
    submittedAt: input.submittedAt,
    rewardAzc: input.rewardAzc,
    ...(input.stageNumber !== undefined
      ? { stageNumber: input.stageNumber }
      : {}),
    ...(input.requiredDepositRub !== undefined
      ? { requiredDepositRub: input.requiredDepositRub }
      : {}),
  });
  await enqueueAdminTelegramNoticesIn(tx, {
    idempotencyPrefix: `welvura:admin:${input.kind}:${input.submissionId}`,
    caption,
    storageKey: input.storageKey,
    replyMarkup: welvuraAdminReviewReplyMarkup(input.kind, input.submissionId),
  });
}

async function storeScreenshot(
  tx: GiftbotTx,
  storage: SubmissionFileStorage,
  input: {
    userId: string;
    contentType: string;
    bytes: Buffer;
    originalFilename?: string;
  },
): Promise<{ id: string; storageKey: string }> {
  const stored = await storage.put(input);
  try {
    const inserted = await tx
      .insert(submissionFiles)
      .values({
        storageKey: stored.storageKey,
        contentType: stored.contentType,
        byteSize: stored.byteSize,
        originalFilename: input.originalFilename,
        createdByUserId: input.userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new WelvuraInvalidFileError();
    }
    return { id: row.id, storageKey: stored.storageKey };
  } catch (error) {
    await storage.delete(stored.storageKey);
    throw error;
  }
}

export type WelvuraAccountState =
  | "not_submitted"
  | "pending"
  | "approved"
  | "rejected";

export type WelvuraStageState =
  | "locked"
  | "available"
  | "pending"
  | "approved"
  | "rejected";

export async function readWelvuraState(db: GiftbotDb, userId: string) {
  const [linkRows, accountSubs, stageCompletions, depositSubs] = await Promise.all([
    db.select().from(welvuraLinks).where(eq(welvuraLinks.userId, userId)).limit(1),
    db
      .select()
      .from(welvuraAccountSubmissions)
      .where(eq(welvuraAccountSubmissions.userId, userId))
      .orderBy(desc(welvuraAccountSubmissions.attemptNumber)),
    db
      .select()
      .from(welvuraStageCompletions)
      .where(eq(welvuraStageCompletions.userId, userId)),
    db
      .select()
      .from(welvuraDepositSubmissions)
      .where(eq(welvuraDepositSubmissions.userId, userId))
      .orderBy(
        desc(welvuraDepositSubmissions.stageNumber),
        desc(welvuraDepositSubmissions.attemptNumber),
      ),
  ]);

  const link = linkRows[0];
  const latestAccount = accountSubs[0];
  let accountState: WelvuraAccountState = "not_submitted";
  if (link?.status === "approved") {
    accountState = "approved";
  } else if (latestAccount?.status === "pending") {
    accountState = "pending";
  } else if (latestAccount?.status === "rejected" || link?.status === "rejected") {
    accountState = "rejected";
  }

  const completed = new Set(stageCompletions.map((row) => row.stageNumber));
  const pendingByStage = new Map<number, (typeof depositSubs)[0]>();
  const latestRejectedByStage = new Map<number, (typeof depositSubs)[0]>();
  for (const sub of depositSubs) {
    if (sub.status === "pending" && !pendingByStage.has(sub.stageNumber)) {
      pendingByStage.set(sub.stageNumber, sub);
    }
    if (sub.status === "rejected" && !latestRejectedByStage.has(sub.stageNumber)) {
      latestRejectedByStage.set(sub.stageNumber, sub);
    }
  }

  const stages = WELVURA_DEPOSIT_STAGES.map((stage) => {
    let state: WelvuraStageState = "locked";
    let rejectionReason: string | null = null;
    if (completed.has(stage.stageNumber)) {
      state = "approved";
    } else if (pendingByStage.has(stage.stageNumber)) {
      state = "pending";
    } else if (accountState !== "approved") {
      state = "locked";
    } else if (stage.stageNumber === 1 || completed.has(stage.stageNumber - 1)) {
      const rejected = latestRejectedByStage.get(stage.stageNumber);
      if (rejected) {
        state = "rejected";
        rejectionReason = rejected.rejectionReason;
      } else {
        state = "available";
      }
    } else {
      state = "locked";
    }
    return {
      stageNumber: stage.stageNumber,
      requiredDepositRub: stage.requiredDepositRub.toString(),
      rewardAzc: stage.rewardAzc.toString(),
      instruction: welvuraStageInstruction(stage.requiredDepositRub),
      state,
      rejectionReason,
    };
  });

  return {
    account: {
      state: accountState,
      welvuraId: link?.welvuraExternalId ?? latestAccount?.welvuraExternalId ?? null,
      rejectionReason:
        accountState === "rejected"
          ? latestAccount?.rejectionReason ?? null
          : null,
      rewardAzc: WELVURA_ACCOUNT_LINK_REWARD_AZC.toString(),
    },
    policy: {
      depositsFrom: WELVURA_DEPOSIT_POLICY_FROM,
      oneDepositOneStage: true,
    },
    progress: {
      completedStages: completed.size,
      totalStages: WELVURA_DEPOSIT_STAGES.length,
    },
    stages,
  };
}

export async function submitWelvuraAccount(
  db: GiftbotDb,
  storage: SubmissionFileStorage,
  input: {
    userId: string;
    welvuraId: string;
    contentType: string;
    bytes: Buffer;
    originalFilename?: string;
  },
) {
  const welvuraId = normalizeWelvuraId(input.welvuraId);
  return db.transaction(async (tx) => {
    const link = await tx
      .select()
      .from(welvuraLinks)
      .where(eq(welvuraLinks.userId, input.userId))
      .limit(1);
    if (link[0]?.status === "approved") {
      throw new WelvuraAlreadyModeratedError();
    }
    const pending = await tx
      .select({ id: welvuraAccountSubmissions.id })
      .from(welvuraAccountSubmissions)
      .where(
        and(
          eq(welvuraAccountSubmissions.userId, input.userId),
          eq(welvuraAccountSubmissions.status, "pending"),
        ),
      )
      .limit(1);
    if (pending[0]) {
      throw new WelvuraSubmissionPendingError();
    }

    const attempts = await tx
      .select({ value: sql<number>`coalesce(max(${welvuraAccountSubmissions.attemptNumber}), 0)::int` })
      .from(welvuraAccountSubmissions)
      .where(eq(welvuraAccountSubmissions.userId, input.userId));
    const attemptNumber = Number(attempts[0]?.value ?? 0) + 1;

    const screenshot = await storeScreenshot(tx, storage, {
      userId: input.userId,
      contentType: input.contentType,
      bytes: input.bytes,
      ...(input.originalFilename
        ? { originalFilename: input.originalFilename }
        : {}),
    });

    const inserted = await tx
      .insert(welvuraAccountSubmissions)
      .values({
        userId: input.userId,
        attemptNumber,
        welvuraExternalId: welvuraId,
        screenshotFileId: screenshot.id,
        status: "pending",
      })
      .returning();
    const submission = inserted[0];
    if (!submission) {
      throw new Error("failed to create account submission");
    }

    await tx
      .insert(welvuraLinks)
      .values({
        userId: input.userId,
        welvuraExternalId: welvuraId,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: welvuraLinks.userId,
        set: {
          welvuraExternalId: welvuraId,
          status: "pending",
          updatedAt: new Date(),
        },
      });

    await notifyAdminsWelvuraSubmission(tx, {
      kind: "account",
      submissionId: submission.id,
      userId: input.userId,
      welvuraId,
      storageKey: screenshot.storageKey,
      submittedAt: submission.createdAt,
      rewardAzc: WELVURA_ACCOUNT_LINK_REWARD_AZC,
    });

    return {
      submissionId: submission.id,
      status: "pending" as const,
      attemptNumber,
    };
  });
}

export async function submitWelvuraDeposit(
  db: GiftbotDb,
  storage: SubmissionFileStorage,
  input: {
    userId: string;
    stageNumber: number;
    contentType: string;
    bytes: Buffer;
    originalFilename?: string;
  },
) {
  const stage = getWelvuraStage(input.stageNumber);
  return db.transaction(async (tx) => {
    const link = await tx
      .select()
      .from(welvuraLinks)
      .where(eq(welvuraLinks.userId, input.userId))
      .limit(1);
    if (!link[0] || link[0].status !== "approved" || !link[0].welvuraExternalId) {
      throw new WelvuraAccountNotApprovedError();
    }

    const completed = await tx
      .select({ stageNumber: welvuraStageCompletions.stageNumber })
      .from(welvuraStageCompletions)
      .where(eq(welvuraStageCompletions.userId, input.userId));
    const done = new Set(completed.map((row) => row.stageNumber));
    if (done.has(stage.stageNumber)) {
      throw new WelvuraStageAlreadyCompletedError();
    }
    if (stage.stageNumber > 1 && !done.has(stage.stageNumber - 1)) {
      throw new WelvuraStageLockedError();
    }

    const pending = await tx
      .select({ id: welvuraDepositSubmissions.id })
      .from(welvuraDepositSubmissions)
      .where(
        and(
          eq(welvuraDepositSubmissions.userId, input.userId),
          eq(welvuraDepositSubmissions.stageNumber, stage.stageNumber),
          eq(welvuraDepositSubmissions.status, "pending"),
        ),
      )
      .limit(1);
    if (pending[0]) {
      throw new WelvuraSubmissionPendingError();
    }

    const attempts = await tx
      .select({
        value: sql<number>`coalesce(max(${welvuraDepositSubmissions.attemptNumber}), 0)::int`,
      })
      .from(welvuraDepositSubmissions)
      .where(
        and(
          eq(welvuraDepositSubmissions.userId, input.userId),
          eq(welvuraDepositSubmissions.stageNumber, stage.stageNumber),
        ),
      );
    const attemptNumber = Number(attempts[0]?.value ?? 0) + 1;

    const screenshot = await storeScreenshot(tx, storage, {
      userId: input.userId,
      contentType: input.contentType,
      bytes: input.bytes,
      ...(input.originalFilename
        ? { originalFilename: input.originalFilename }
        : {}),
    });

    const inserted = await tx
      .insert(welvuraDepositSubmissions)
      .values({
        userId: input.userId,
        stageNumber: stage.stageNumber,
        attemptNumber,
        welvuraExternalId: link[0].welvuraExternalId,
        requiredDepositRub: stage.requiredDepositRub,
        rewardAzc: stage.rewardAzc,
        screenshotFileId: screenshot.id,
        status: "pending",
      })
      .returning();
    const submission = inserted[0];
    if (!submission) {
      throw new Error("failed to create deposit submission");
    }
    await notifyAdminsWelvuraSubmission(tx, {
      kind: "deposit",
      submissionId: submission.id,
      userId: input.userId,
      welvuraId: link[0].welvuraExternalId,
      storageKey: screenshot.storageKey,
      submittedAt: submission.createdAt,
      rewardAzc: stage.rewardAzc,
      stageNumber: stage.stageNumber,
      requiredDepositRub: stage.requiredDepositRub,
    });
    return {
      submissionId: submission.id,
      stageNumber: stage.stageNumber,
      status: "pending" as const,
      attemptNumber,
    };
  });
}

export async function approveWelvuraAccount(
  db: GiftbotDb,
  input: { submissionId: string; adminUserId: string; requestId?: string },
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(welvuraAccountSubmissions)
      .where(eq(welvuraAccountSubmissions.id, input.submissionId))
      .for("update");
    const submission = rows[0];
    if (!submission) {
      throw new NotFoundError("submission not found", "WELVURA_SUBMISSION_NOT_FOUND");
    }
    if (submission.status !== "pending") {
      throw new WelvuraAlreadyModeratedError();
    }
    const now = new Date();
    await tx
      .update(welvuraAccountSubmissions)
      .set({
        status: "approved",
        moderatedAt: now,
        moderatedByAdminId: input.adminUserId,
      })
      .where(eq(welvuraAccountSubmissions.id, submission.id));

    await ensureWallet(tx, submission.userId);
    await applyIn(tx, {
      userId: submission.userId,
      type: "task_reward",
      amountMinor: WELVURA_ACCOUNT_LINK_REWARD_AZC,
      idempotencyKey: `welvura.account.reward:${submission.id}`,
      actorType: "admin",
      actorId: input.adminUserId,
      reason: "Welvura привязка аккаунта",
      referenceType: "welvura_account_submission",
      referenceId: submission.id,
    });

    await tx
      .insert(welvuraLinks)
      .values({
        userId: submission.userId,
        welvuraExternalId: submission.welvuraExternalId,
        status: "approved",
      })
      .onConflictDoUpdate({
        target: welvuraLinks.userId,
        set: {
          welvuraExternalId: submission.welvuraExternalId,
          status: "approved",
          updatedAt: now,
        },
      });

    await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "welvura.account.approved",
      targetType: "welvura_account_submission",
      targetId: submission.id,
      reason: "approved",
      after: { userId: submission.userId, welvuraId: submission.welvuraExternalId },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });

    await insertInbox(tx, {
      userId: submission.userId,
      type: "welvura_account_approved",
      title: "Welvura привязан",
      body: "Привязка подтверждена. Первое задание доступно.",
      payload: { submissionId: submission.id },
    });
    await enqueueTelegramNotice(tx, {
      userId: submission.userId,
      idempotencyKey: `welvura:account:approved:${submission.id}`,
      text: "Привязка Welvura подтверждена. Первое задание доступно.",
    });

    return { submissionId: submission.id, status: "approved" as const };
  });
}

export async function rejectWelvuraAccount(
  db: GiftbotDb,
  input: {
    submissionId: string;
    adminUserId: string;
    reason: string;
    requestId?: string;
  },
) {
  const reason = input.reason.trim();
  if (!reason) {
    throw new WelvuraRejectionReasonRequiredError();
  }
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(welvuraAccountSubmissions)
      .where(eq(welvuraAccountSubmissions.id, input.submissionId))
      .for("update");
    const submission = rows[0];
    if (!submission) {
      throw new NotFoundError("submission not found", "WELVURA_SUBMISSION_NOT_FOUND");
    }
    if (submission.status !== "pending") {
      throw new WelvuraAlreadyModeratedError();
    }
    const now = new Date();
    await tx
      .update(welvuraAccountSubmissions)
      .set({
        status: "rejected",
        moderatedAt: now,
        moderatedByAdminId: input.adminUserId,
        rejectionReason: reason,
      })
      .where(eq(welvuraAccountSubmissions.id, submission.id));

    await tx
      .insert(welvuraLinks)
      .values({
        userId: submission.userId,
        welvuraExternalId: submission.welvuraExternalId,
        status: "rejected",
      })
      .onConflictDoUpdate({
        target: welvuraLinks.userId,
        set: {
          welvuraExternalId: submission.welvuraExternalId,
          status: "rejected",
          updatedAt: now,
        },
      });

    await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "welvura.account.rejected",
      targetType: "welvura_account_submission",
      targetId: submission.id,
      reason,
      after: { userId: submission.userId },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });

    await insertInbox(tx, {
      userId: submission.userId,
      type: "welvura_account_rejected",
      title: "Заявка Welvura отклонена",
      body: reason,
      payload: { submissionId: submission.id, reason },
    });
    await enqueueTelegramNotice(tx, {
      userId: submission.userId,
      idempotencyKey: `welvura:account:rejected:${submission.id}`,
      text: `Заявка на привязку Welvura отклонена. Причина: ${reason}. Можно отправить заново.`,
    });

    return { submissionId: submission.id, status: "rejected" as const, reason };
  });
}

export async function approveWelvuraDeposit(
  db: GiftbotDb,
  input: {
    submissionId: string;
    adminUserId: string;
    requestId?: string;
    failAfterMarkForTests?: boolean;
  },
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(welvuraDepositSubmissions)
      .where(eq(welvuraDepositSubmissions.id, input.submissionId))
      .for("update");
    const submission = rows[0];
    if (!submission) {
      throw new NotFoundError("submission not found", "WELVURA_SUBMISSION_NOT_FOUND");
    }
    if (submission.status !== "pending") {
      throw new WelvuraAlreadyModeratedError();
    }

    const link = await tx
      .select()
      .from(welvuraLinks)
      .where(eq(welvuraLinks.userId, submission.userId))
      .limit(1);
    if (!link[0] || link[0].status !== "approved") {
      throw new WelvuraAccountNotApprovedError();
    }

    if (submission.stageNumber > 1) {
      const prev = await tx
        .select({ id: welvuraStageCompletions.id })
        .from(welvuraStageCompletions)
        .where(
          and(
            eq(welvuraStageCompletions.userId, submission.userId),
            eq(welvuraStageCompletions.stageNumber, submission.stageNumber - 1),
          ),
        )
        .limit(1);
      if (!prev[0]) {
        throw new WelvuraStageLockedError();
      }
    }

    const now = new Date();
    await tx
      .update(welvuraDepositSubmissions)
      .set({
        status: "approved",
        moderatedAt: now,
        moderatedByAdminId: input.adminUserId,
      })
      .where(eq(welvuraDepositSubmissions.id, submission.id));

    if (input.failAfterMarkForTests) {
      throw new Error("forced approve failure");
    }

    await ensureWallet(tx, submission.userId);
    const paid = await applyIn(tx, {
      userId: submission.userId,
      type: "welvura_deposit_reward",
      amountMinor: asBigInt(submission.rewardAzc),
      idempotencyKey: `welvura.deposit.reward:${submission.id}`,
      actorType: "admin",
      actorId: input.adminUserId,
      reason: `Welvura задание №${submission.stageNumber}`,
      referenceType: "welvura_deposit_submission",
      referenceId: submission.id,
      metadata: {
        stageNumber: submission.stageNumber,
        requiredDepositRub: asBigInt(submission.requiredDepositRub).toString(),
      },
    });

    await tx
      .update(welvuraDepositSubmissions)
      .set({ rewardTransactionId: paid.transaction.id })
      .where(eq(welvuraDepositSubmissions.id, submission.id));

    await tx.insert(welvuraStageCompletions).values({
      userId: submission.userId,
      stageNumber: submission.stageNumber,
      submissionId: submission.id,
      rewardAzc: submission.rewardAzc,
      rewardTransactionId: paid.transaction.id,
      completedAt: now,
    });

    await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "welvura.deposit.approved",
      targetType: "welvura_deposit_submission",
      targetId: submission.id,
      reason: "approved",
      after: {
        userId: submission.userId,
        stageNumber: submission.stageNumber,
        rewardAzc: asBigInt(submission.rewardAzc).toString(),
      },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });

    const next =
      submission.stageNumber < 13
        ? ` Следующее задание №${submission.stageNumber + 1} доступно.`
        : "";
    await insertInbox(tx, {
      userId: submission.userId,
      type: "welvura_deposit_approved",
      title: `Задание №${submission.stageNumber} выполнено`,
      body: `+${asBigInt(submission.rewardAzc).toString()} AZC.${next}`,
      payload: {
        submissionId: submission.id,
        stageNumber: submission.stageNumber,
      },
    });
    await enqueueTelegramNotice(tx, {
      userId: submission.userId,
      idempotencyKey: `welvura:deposit:approved:${submission.id}`,
      text: `Welvura задание №${submission.stageNumber} выполнено. +${asBigInt(submission.rewardAzc).toString()} AZC.${next}`,
    });

    return {
      submissionId: submission.id,
      status: "approved" as const,
      rewardAzc: asBigInt(submission.rewardAzc).toString(),
      balances: { azc: asBigInt(paid.wallet.balanceMinor).toString() },
    };
  });
}

export async function rejectWelvuraDeposit(
  db: GiftbotDb,
  input: {
    submissionId: string;
    adminUserId: string;
    reason: string;
    requestId?: string;
  },
) {
  const reason = input.reason.trim();
  if (!reason) {
    throw new WelvuraRejectionReasonRequiredError();
  }
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(welvuraDepositSubmissions)
      .where(eq(welvuraDepositSubmissions.id, input.submissionId))
      .for("update");
    const submission = rows[0];
    if (!submission) {
      throw new NotFoundError("submission not found", "WELVURA_SUBMISSION_NOT_FOUND");
    }
    if (submission.status !== "pending") {
      throw new WelvuraAlreadyModeratedError();
    }
    const now = new Date();
    await tx
      .update(welvuraDepositSubmissions)
      .set({
        status: "rejected",
        moderatedAt: now,
        moderatedByAdminId: input.adminUserId,
        rejectionReason: reason,
      })
      .where(eq(welvuraDepositSubmissions.id, submission.id));

    await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "welvura.deposit.rejected",
      targetType: "welvura_deposit_submission",
      targetId: submission.id,
      reason,
      after: {
        userId: submission.userId,
        stageNumber: submission.stageNumber,
      },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });

    await insertInbox(tx, {
      userId: submission.userId,
      type: "welvura_deposit_rejected",
      title: `Задание №${submission.stageNumber} отклонено`,
      body: reason,
      payload: {
        submissionId: submission.id,
        stageNumber: submission.stageNumber,
        reason,
      },
    });
    await enqueueTelegramNotice(tx, {
      userId: submission.userId,
      idempotencyKey: `welvura:deposit:rejected:${submission.id}`,
      text: `Welvura задание №${submission.stageNumber} отклонено. Причина: ${reason}. Можно отправить новый скриншот.`,
    });

    return { submissionId: submission.id, status: "rejected" as const, reason };
  });
}

export async function listWelvuraAccountQueue(
  db: GiftbotDb,
  input: { status?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const filters = [];
  if (input.status && input.status !== "all") {
    filters.push(eq(welvuraAccountSubmissions.status, input.status));
  }
  const rows = await db
    .select({
      submission: welvuraAccountSubmissions,
      username: telegramAccounts.username,
      publicId: users.publicId,
      storageKey: submissionFiles.storageKey,
      contentType: submissionFiles.contentType,
    })
    .from(welvuraAccountSubmissions)
    .innerJoin(users, eq(users.id, welvuraAccountSubmissions.userId))
    .innerJoin(
      submissionFiles,
      eq(submissionFiles.id, welvuraAccountSubmissions.screenshotFileId),
    )
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, welvuraAccountSubmissions.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(welvuraAccountSubmissions.submittedAt))
    .limit(limit);

  return {
    items: rows.map((row) => ({
      id: row.submission.id,
      userId: row.submission.userId,
      publicId: row.publicId,
      username: row.username,
      welvuraId: row.submission.welvuraExternalId,
      attemptNumber: row.submission.attemptNumber,
      status: row.submission.status,
      submittedAt: row.submission.submittedAt.toISOString(),
      moderatedAt: row.submission.moderatedAt?.toISOString() ?? null,
      rejectionReason: row.submission.rejectionReason,
      screenshot: {
        fileId: row.submission.screenshotFileId,
        storageKey: row.storageKey,
        contentType: row.contentType,
      },
    })),
  };
}

export async function listWelvuraDepositQueue(
  db: GiftbotDb,
  input: { status?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const filters = [];
  if (input.status && input.status !== "all") {
    filters.push(eq(welvuraDepositSubmissions.status, input.status));
  }
  const rows = await db
    .select({
      submission: welvuraDepositSubmissions,
      username: telegramAccounts.username,
      publicId: users.publicId,
      storageKey: submissionFiles.storageKey,
      contentType: submissionFiles.contentType,
    })
    .from(welvuraDepositSubmissions)
    .innerJoin(users, eq(users.id, welvuraDepositSubmissions.userId))
    .innerJoin(
      submissionFiles,
      eq(submissionFiles.id, welvuraDepositSubmissions.screenshotFileId),
    )
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, welvuraDepositSubmissions.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(welvuraDepositSubmissions.submittedAt))
    .limit(limit);

  return {
    items: rows.map((row) => ({
      id: row.submission.id,
      userId: row.submission.userId,
      publicId: row.publicId,
      username: row.username,
      welvuraId: row.submission.welvuraExternalId,
      stageNumber: row.submission.stageNumber,
      attemptNumber: row.submission.attemptNumber,
      requiredDepositRub: asBigInt(row.submission.requiredDepositRub).toString(),
      rewardAzc: asBigInt(row.submission.rewardAzc).toString(),
      status: row.submission.status,
      submittedAt: row.submission.submittedAt.toISOString(),
      moderatedAt: row.submission.moderatedAt?.toISOString() ?? null,
      rejectionReason: row.submission.rejectionReason,
      policyFrom: WELVURA_DEPOSIT_POLICY_FROM,
      screenshot: {
        fileId: row.submission.screenshotFileId,
        storageKey: row.storageKey,
        contentType: row.contentType,
      },
    })),
  };
}

export async function listUserWelvuraAccountHistory(
  db: GiftbotDb,
  userId: string,
) {
  const rows = await db
    .select()
    .from(welvuraAccountSubmissions)
    .where(eq(welvuraAccountSubmissions.userId, userId))
    .orderBy(desc(welvuraAccountSubmissions.attemptNumber));
  return {
    items: rows.map((row) => ({
      id: row.id,
      attemptNumber: row.attemptNumber,
      welvuraId: row.welvuraExternalId,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      moderatedAt: row.moderatedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      screenshotFileId: row.screenshotFileId,
    })),
  };
}

export async function listUserWelvuraStageHistory(
  db: GiftbotDb,
  input: { userId: string; stageNumber: number },
) {
  getWelvuraStage(input.stageNumber);
  const rows = await db
    .select()
    .from(welvuraDepositSubmissions)
    .where(
      and(
        eq(welvuraDepositSubmissions.userId, input.userId),
        eq(welvuraDepositSubmissions.stageNumber, input.stageNumber),
      ),
    )
    .orderBy(desc(welvuraDepositSubmissions.attemptNumber));
  return {
    items: rows.map((row) => ({
      id: row.id,
      stageNumber: row.stageNumber,
      attemptNumber: row.attemptNumber,
      welvuraId: row.welvuraExternalId,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      moderatedAt: row.moderatedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      rewardAzc: asBigInt(row.rewardAzc).toString(),
      screenshotFileId: row.screenshotFileId,
    })),
  };
}

export async function getSubmissionFileMeta(
  db: GiftbotDb,
  fileId: string,
): Promise<{ storageKey: string; contentType: string; byteSize: number } | null> {
  const rows = await db
    .select({
      storageKey: submissionFiles.storageKey,
      contentType: submissionFiles.contentType,
      byteSize: submissionFiles.byteSize,
    })
    .from(submissionFiles)
    .where(eq(submissionFiles.id, fileId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    storageKey: row.storageKey,
    contentType: row.contentType,
    byteSize: row.byteSize,
  };
}
