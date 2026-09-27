import {
  kickAccounts,
  notifications,
  referrals,
  userTaskCompletions,
  userTaskEvidence,
  wallets,
} from "@giftbot/db/schema";
import { and, count, eq, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  TaskNotFoundError,
  TaskRequirementNotMetError,
  TaskVerificationUnavailableError,
} from "./errors.js";
import { asBigInt } from "./money.js";
import { applyIn } from "./wallet.js";

export type TaskCategory = "kick" | "tg" | "social" | "partners";

export type TaskCode =
  | "kick_nickname_tag"
  | "kick_link"
  | "kick_follow_azarov7777"
  | "telegram_subscribe_azarov222"
  | "telegram_bot_started"
  | "referral_3_active";

export type TaskDefinition = {
  code: TaskCode;
  title: string;
  description: string;
  category: TaskCategory;
  rewardAzc: bigint;
  actionHint?: string;
};

export const TASK_CATALOG: readonly TaskDefinition[] = [
  {
    code: "kick_nickname_tag",
    title: "Добавить azarov7777 в ник Kick",
    description: "Добавь `azarov7777` в никнейм Kick (без учёта регистра).",
    category: "kick",
    rewardAzc: 400n,
    actionHint: "kick_nickname",
  },
  {
    code: "kick_link",
    title: "Привязать Kick",
    description: "Привяжи Kick-аккаунт к профилю AZAROV.",
    category: "kick",
    rewardAzc: 400n,
    actionHint: "kick_link",
  },
  {
    code: "kick_follow_azarov7777",
    title: "Подписаться на Kick канал azarov7777",
    description: "Подпишись на Kick-канал azarov7777.",
    category: "kick",
    rewardAzc: 500n,
    actionHint: "kick_follow",
  },
  {
    code: "telegram_subscribe_azarov222",
    title: "Подписаться на Telegram канал @azarov222",
    description: "Подпишись на Telegram-канал @azarov222.",
    category: "tg",
    rewardAzc: 500n,
    actionHint: "telegram_channel",
  },
  {
    code: "telegram_bot_started",
    title: "Запустить нашего бота @AZAROV_GiftBot",
    description: "Открой бота и нажми /start.",
    category: "tg",
    rewardAzc: 600n,
    actionHint: "telegram_bot",
  },
  {
    code: "referral_3_active",
    title: "Пригласить 3 активных друзей",
    description: "Пригласи 3 друзей, которые активировали реферал через Kick.",
    category: "social",
    rewardAzc: 2_000n,
    actionHint: "friends",
  },
] as const;

const BY_CODE = new Map(TASK_CATALOG.map((row) => [row.code, row] as const));

export function getTask(code: string): TaskDefinition {
  const found = BY_CODE.get(code as TaskCode);
  if (!found) {
    throw new TaskNotFoundError();
  }
  return found;
}

export function isTaskCode(value: string): value is TaskCode {
  return BY_CODE.has(value as TaskCode);
}

export type TaskUserState =
  | "available"
  | "completed"
  | "requirement_not_met"
  | "verification_unavailable";

export type TaskListItem = {
  code: TaskCode;
  title: string;
  description: string;
  category: TaskCategory;
  rewardAzc: string;
  state: TaskUserState;
  completedAt: string | null;
  actionHint?: string;
};

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

async function ensureEvidence(
  tx: GiftbotTx,
  userId: string,
): Promise<typeof userTaskEvidence.$inferSelect> {
  const existing = await tx
    .select()
    .from(userTaskEvidence)
    .where(eq(userTaskEvidence.userId, userId))
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }
  const inserted = await tx
    .insert(userTaskEvidence)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) {
    return inserted[0];
  }
  const again = await tx
    .select()
    .from(userTaskEvidence)
    .where(eq(userTaskEvidence.userId, userId))
    .limit(1);
  if (!again[0]) {
    throw new Error("failed to ensure task evidence");
  }
  return again[0];
}

export async function markBotStarted(
  db: GiftbotDb,
  userId: string,
  at: Date = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const evidence = await ensureEvidence(tx, userId);
    if (evidence.botStartedAt) {
      return;
    }
    await tx
      .update(userTaskEvidence)
      .set({
        botStartedAt: at,
        updatedAt: new Date(),
      })
      .where(eq(userTaskEvidence.userId, userId));
  });
}

/** DEV/production fixture setters — trusted evidence only. */
export async function setTaskEvidenceForTests(
  db: GiftbotDb,
  userId: string,
  patch: {
    botStartedAt?: Date | null;
    telegramChannelMemberAt?: Date | null;
    kickFollowAzarovAt?: Date | null;
    kickNicknameSnapshot?: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await ensureEvidence(tx, userId);
    await tx
      .update(userTaskEvidence)
      .set({
        ...(patch.botStartedAt !== undefined
          ? { botStartedAt: patch.botStartedAt }
          : {}),
        ...(patch.telegramChannelMemberAt !== undefined
          ? { telegramChannelMemberAt: patch.telegramChannelMemberAt }
          : {}),
        ...(patch.kickFollowAzarovAt !== undefined
          ? { kickFollowAzarovAt: patch.kickFollowAzarovAt }
          : {}),
        ...(patch.kickNicknameSnapshot !== undefined
          ? {
              kickNicknameSnapshot: patch.kickNicknameSnapshot,
              kickNicknameCheckedAt: new Date(),
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(userTaskEvidence.userId, userId));
  });
}

type VerifyResult =
  | { ok: true; snapshot: Record<string, unknown> }
  | { ok: false; kind: "not_met" | "unavailable"; detail?: string };

async function verifyTask(
  tx: GiftbotTx,
  userId: string,
  task: TaskDefinition,
): Promise<VerifyResult> {
  switch (task.code) {
    case "kick_link": {
      const rows = await tx
        .select({ id: kickAccounts.id, kickUserId: kickAccounts.kickUserId })
        .from(kickAccounts)
        .where(
          and(eq(kickAccounts.userId, userId), eq(kickAccounts.status, "active")),
        )
        .limit(1);
      if (!rows[0]) {
        return { ok: false, kind: "not_met", detail: "kick not linked" };
      }
      return {
        ok: true,
        snapshot: { kickAccountId: rows[0].id, kickUserId: rows[0].kickUserId },
      };
    }
    case "referral_3_active": {
      const rows = await tx
        .select({ value: count() })
        .from(referrals)
        .where(
          and(
            eq(referrals.referrerUserId, userId),
            eq(referrals.status, "activated"),
          ),
        );
      const active = Number(rows[0]?.value ?? 0);
      if (active < 3) {
        return {
          ok: false,
          kind: "not_met",
          detail: `active referrals ${active} < 3`,
        };
      }
      return { ok: true, snapshot: { activeReferrals: active } };
    }
    case "telegram_bot_started": {
      const evidence = await ensureEvidence(tx, userId);
      if (!evidence.botStartedAt) {
        return { ok: false, kind: "not_met", detail: "bot not started" };
      }
      return {
        ok: true,
        snapshot: { botStartedAt: evidence.botStartedAt.toISOString() },
      };
    }
    case "telegram_subscribe_azarov222": {
      const evidence = await ensureEvidence(tx, userId);
      if (!evidence.telegramChannelMemberAt) {
        // Production Telegram getChatMember not wired; evidence or DEV fixture required.
        return {
          ok: false,
          kind: "unavailable",
          detail: "telegram membership check unavailable",
        };
      }
      return {
        ok: true,
        snapshot: {
          memberAt: evidence.telegramChannelMemberAt.toISOString(),
          channel: "@azarov222",
        },
      };
    }
    case "kick_follow_azarov7777": {
      const evidence = await ensureEvidence(tx, userId);
      if (!evidence.kickFollowAzarovAt) {
        return {
          ok: false,
          kind: "unavailable",
          detail: "kick follow check unavailable",
        };
      }
      return {
        ok: true,
        snapshot: {
          followedAt: evidence.kickFollowAzarovAt.toISOString(),
          channel: "azarov7777",
        },
      };
    }
    case "kick_nickname_tag": {
      const kick = await tx
        .select({
          username: kickAccounts.username,
          kickUserId: kickAccounts.kickUserId,
        })
        .from(kickAccounts)
        .where(
          and(eq(kickAccounts.userId, userId), eq(kickAccounts.status, "active")),
        )
        .limit(1);
      if (!kick[0]) {
        return { ok: false, kind: "not_met", detail: "kick not linked" };
      }
      const evidence = await ensureEvidence(tx, userId);
      const nickname =
        evidence.kickNicknameSnapshot ?? kick[0].username ?? null;
      if (!nickname) {
        return {
          ok: false,
          kind: "unavailable",
          detail: "kick nickname unavailable",
        };
      }
      if (!nickname.toLowerCase().includes("azarov7777")) {
        return {
          ok: false,
          kind: "not_met",
          detail: "nickname missing azarov7777",
        };
      }
      return {
        ok: true,
        snapshot: { nickname, kickUserId: kick[0].kickUserId },
      };
    }
    default:
      return { ok: false, kind: "unavailable" };
  }
}

export async function listTasksForUser(
  db: GiftbotDb,
  userId: string,
): Promise<{
  categories: Array<{ id: TaskCategory | "all"; label: string }>;
  tasks: TaskListItem[];
}> {
  const completions = await db
    .select()
    .from(userTaskCompletions)
    .where(eq(userTaskCompletions.userId, userId));
  const byCode = new Map(completions.map((row) => [row.taskCode, row]));

  const tasks: TaskListItem[] = [];
  for (const task of TASK_CATALOG) {
    const done = byCode.get(task.code);
    if (done) {
      tasks.push({
        code: task.code,
        title: task.title,
        description: task.description,
        category: task.category,
        rewardAzc: task.rewardAzc.toString(),
        state: "completed",
        completedAt: done.completedAt.toISOString(),
        ...(task.actionHint ? { actionHint: task.actionHint } : {}),
      });
      continue;
    }
    const verified = await db.transaction(async (tx) => verifyTask(tx, userId, task));
    let state: TaskUserState = "available";
    if (!verified.ok) {
      state =
        verified.kind === "unavailable"
          ? "verification_unavailable"
          : "requirement_not_met";
    }
    tasks.push({
      code: task.code,
      title: task.title,
      description: task.description,
      category: task.category,
      rewardAzc: task.rewardAzc.toString(),
      state,
      completedAt: null,
      ...(task.actionHint ? { actionHint: task.actionHint } : {}),
    });
  }

  return {
    categories: [
      { id: "all", label: "ВСЕ" },
      { id: "kick", label: "KICK" },
      { id: "tg", label: "TG" },
      { id: "social", label: "SOCIAL" },
      { id: "partners", label: "PARTNERS" },
    ],
    tasks,
  };
}

export type TaskClaimResult = {
  taskCode: TaskCode;
  rewardAzc: string;
  completedAt: string;
  balances: { azc: string };
  replayed: boolean;
};

export async function claimTask(
  db: GiftbotDb,
  input: { userId: string; taskCode: string },
): Promise<TaskClaimResult> {
  const task = getTask(input.taskCode);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`task-claim:${input.userId}:${task.code}`}))`,
    );

    const existing = await tx
      .select()
      .from(userTaskCompletions)
      .where(
        and(
          eq(userTaskCompletions.userId, input.userId),
          eq(userTaskCompletions.taskCode, task.code),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const balance = await tx
        .select({ balanceMinor: wallets.balanceMinor })
        .from(wallets)
        .where(eq(wallets.userId, input.userId))
        .limit(1);
      return {
        taskCode: task.code,
        rewardAzc: asBigInt(existing[0].rewardAzc).toString(),
        completedAt: existing[0].completedAt.toISOString(),
        balances: { azc: asBigInt(balance[0]?.balanceMinor ?? 0n).toString() },
        replayed: true,
      };
    }

    const verified = await verifyTask(tx, input.userId, task);
    if (!verified.ok) {
      if (verified.kind === "unavailable") {
        throw new TaskVerificationUnavailableError(verified.detail);
      }
      throw new TaskRequirementNotMetError(verified.detail);
    }

    await ensureWallet(tx, input.userId);
    const paid = await applyIn(tx, {
      userId: input.userId,
      type: "task_reward",
      amountMinor: task.rewardAzc,
      idempotencyKey: `task.reward:${input.userId}:${task.code}`,
      actorType: "system",
      reason: `Задание: ${task.title}`,
      referenceType: "task",
      metadata: {
        taskCode: task.code,
        verification: verified.snapshot,
      },
    });

    const now = new Date();
    await tx.insert(userTaskCompletions).values({
      userId: input.userId,
      taskCode: task.code,
      rewardAzc: task.rewardAzc,
      verificationSnapshot: verified.snapshot,
      rewardTransactionId: paid.transaction.id,
      completedAt: now,
    });

    await tx.insert(notifications).values({
      userId: input.userId,
      channel: "inbox",
      type: "task_completed",
      status: "sent",
      title: "Задание выполнено",
      body: `+${task.rewardAzc.toString()} AZC`,
      sentAt: now,
      payload: { taskCode: task.code, rewardAzc: task.rewardAzc.toString() },
    });

    return {
      taskCode: task.code,
      rewardAzc: task.rewardAzc.toString(),
      completedAt: now.toISOString(),
      balances: { azc: asBigInt(paid.wallet.balanceMinor).toString() },
      replayed: false,
    };
  });
}
