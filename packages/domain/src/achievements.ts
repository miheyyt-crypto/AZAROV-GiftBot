import {
  diceRounds,
  freeCaseOpenings,
  jobs,
  minesGames,
  notifications,
  paidCaseOpenings,
  referralCaseOpenings,
  referrals,
  rollsParticipants,
  rollsRounds,
  telegramAccounts,
  userAchievements,
  userKickStats,
  userProgress,
  wallets,
} from "@giftbot/db/schema";
import { and, count, countDistinct, eq, inArray, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { computeLevel } from "./level.js";
import { asBigInt } from "./money.js";
import { applyIn } from "./wallet.js";

export type AchievementCode =
  | "kick_100_messages"
  | "referrals_5_active"
  | "games_100_total"
  | "cases_25_opened"
  | "level_10";

export type AchievementDefinition = {
  code: AchievementCode;
  title: string;
  description: string;
  emoji: string;
  target: number;
  rewardAzc: bigint;
};

export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] =
  Object.freeze([
    {
      code: "kick_100_messages",
      title: "Первые шаги",
      description: "Напиши 100 сообщений в чате Kick во время стримов",
      emoji: "💬",
      target: 100,
      rewardAzc: 500n,
    },
    {
      code: "referrals_5_active",
      title: "Своя компания",
      description: "Пригласи 5 активных друзей",
      emoji: "👥",
      target: 5,
      rewardAzc: 2_500n,
    },
    {
      code: "games_100_total",
      title: "Игрок",
      description: "Сыграй 100 игр",
      emoji: "🎮",
      target: 100,
      rewardAzc: 3_000n,
    },
    {
      code: "cases_25_opened",
      title: "Любитель кейсов",
      description: "Открой 25 кейсов",
      emoji: "🎁",
      target: 25,
      rewardAzc: 5_000n,
    },
    {
      code: "level_10",
      title: "Преданный зритель",
      description: "Достигни 10 уровня",
      emoji: "⭐",
      target: 10,
      rewardAzc: 10_000n,
    },
  ]);

const BY_CODE = new Map(
  ACHIEVEMENT_CATALOG.map((row) => [row.code, row] as const),
);

/** Deterministic grant order when multiple unlock in one evaluate. */
const GRANT_ORDER = [...ACHIEVEMENT_CATALOG.map((row) => row.code)].sort();

export function getAchievement(code: string): AchievementDefinition {
  const found = BY_CODE.get(code as AchievementCode);
  if (!found) {
    throw new Error(`unknown achievement: ${code}`);
  }
  return found;
}

export function isAchievementCode(value: string): value is AchievementCode {
  return BY_CODE.has(value as AchievementCode);
}

export function achievementRewardLabel(code: AchievementCode): string {
  return `Достижение: ${getAchievement(code).title}`;
}

export type AchievementListItem = {
  code: AchievementCode;
  title: string;
  description: string;
  emoji: string;
  rewardAzc: string;
  current: number;
  target: number;
  progress: number;
  completed: boolean;
  unlockedAt: string | null;
};

export type AchievementGrantResult = {
  code: AchievementCode;
  rewardAzc: string;
  unlockedAt: string;
};

export type EvaluateAchievementsResult = {
  granted: AchievementGrantResult[];
};

type MetricSnapshot = {
  kickMessages: number;
  referralsActivated: number;
  gamesTotal: number;
  casesOpened: number;
  level: number;
};

function progressRatio(current: number, target: number): number {
  if (target <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, current / target));
}

function metricFor(
  code: AchievementCode,
  metrics: MetricSnapshot,
): number {
  switch (code) {
    case "kick_100_messages":
      return metrics.kickMessages;
    case "referrals_5_active":
      return metrics.referralsActivated;
    case "games_100_total":
      return metrics.gamesTotal;
    case "cases_25_opened":
      return metrics.casesOpened;
    case "level_10":
      return metrics.level;
  }
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

async function ensureKickStatsRow(
  tx: GiftbotTx,
  userId: string,
): Promise<typeof userKickStats.$inferSelect> {
  await tx.insert(userKickStats).values({ userId }).onConflictDoNothing();
  const rows = await tx
    .select()
    .from(userKickStats)
    .where(eq(userKickStats.userId, userId))
    .limit(1);
  if (!rows[0]) {
    throw new Error("failed to ensure user_kick_stats");
  }
  return rows[0];
}

async function loadMetrics(
  db: GiftbotDb | GiftbotTx,
  userId: string,
): Promise<MetricSnapshot> {
  const kickRows = await db
    .select({ chatMessagesCounted: userKickStats.chatMessagesCounted })
    .from(userKickStats)
    .where(eq(userKickStats.userId, userId))
    .limit(1);
  const kickMessages = Number(asBigInt(kickRows[0]?.chatMessagesCounted ?? 0n));

  const referralRows = await db
    .select({ value: count() })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrerUserId, userId),
        eq(referrals.status, "activated"),
      ),
    );
  const referralsActivated = Number(referralRows[0]?.value ?? 0);

  const minesRows = await db
    .select({ value: count() })
    .from(minesGames)
    .where(
      and(
        eq(minesGames.userId, userId),
        inArray(minesGames.status, ["cashed_out", "lost", "cleared"]),
      ),
    );
  const minesCount = Number(minesRows[0]?.value ?? 0);

  const diceRows = await db
    .select({ value: count() })
    .from(diceRounds)
    .where(eq(diceRounds.userId, userId));
  const diceCount = Number(diceRows[0]?.value ?? 0);

  const rollsRows = await db
    .select({ value: countDistinct(rollsParticipants.roundId) })
    .from(rollsParticipants)
    .innerJoin(rollsRounds, eq(rollsRounds.id, rollsParticipants.roundId))
    .where(
      and(
        eq(rollsParticipants.userId, userId),
        eq(rollsRounds.status, "resolved"),
      ),
    );
  const rollsCount = Number(rollsRows[0]?.value ?? 0);

  const freeRows = await db
    .select({ value: count() })
    .from(freeCaseOpenings)
    .where(eq(freeCaseOpenings.userId, userId));
  const paidRows = await db
    .select({ value: count() })
    .from(paidCaseOpenings)
    .where(eq(paidCaseOpenings.userId, userId));
  const referralCaseRows = await db
    .select({ value: count() })
    .from(referralCaseOpenings)
    .where(eq(referralCaseOpenings.userId, userId));
  const casesOpened =
    Number(freeRows[0]?.value ?? 0) +
    Number(paidRows[0]?.value ?? 0) +
    Number(referralCaseRows[0]?.value ?? 0);

  const progressRows = await db
    .select({ totalXp: userProgress.totalXp })
    .from(userProgress)
    .where(eq(userProgress.userId, userId))
    .limit(1);
  const level = computeLevel(asBigInt(progressRows[0]?.totalXp ?? 0n)).current;

  return {
    kickMessages,
    referralsActivated,
    gamesTotal: minesCount + diceCount + rollsCount,
    casesOpened,
    level,
  };
}

async function insertInbox(
  tx: GiftbotTx,
  input: {
    userId: string;
    code: AchievementCode;
    title: string;
    rewardAzc: bigint;
  },
): Promise<void> {
  await tx.insert(notifications).values({
    userId: input.userId,
    channel: "inbox",
    type: "achievement_unlocked",
    status: "sent",
    title: "Достижение разблокировано!",
    body: `${input.title}: +${input.rewardAzc.toString()} AZC`,
    sentAt: new Date(),
    payload: {
      achievementCode: input.code,
      rewardAzc: input.rewardAzc.toString(),
    },
  });
}

async function enqueueTelegramNotice(
  tx: GiftbotTx,
  input: { userId: string; code: AchievementCode; text: string },
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
      payload: { chat_id: Number(chatId), text: input.text },
      idempotencyKey: `achievement.telegram:${input.userId}:${input.code}`,
    })
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] });
}

async function grantAchievementIn(
  tx: GiftbotTx,
  input: {
    userId: string;
    def: AchievementDefinition;
    metrics: MetricSnapshot;
  },
): Promise<AchievementGrantResult | null> {
  const existing = await tx
    .select({ id: userAchievements.id })
    .from(userAchievements)
    .where(
      and(
        eq(userAchievements.userId, input.userId),
        eq(userAchievements.achievementCode, input.def.code),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return null;
  }

  await ensureWallet(tx, input.userId);
  const reason = achievementRewardLabel(input.def.code);
  const paid = await applyIn(tx, {
    userId: input.userId,
    type: "achievement_reward",
    amountMinor: input.def.rewardAzc,
    idempotencyKey: `achievement.reward:${input.userId}:${input.def.code}`,
    actorType: "system",
    reason,
    referenceType: "achievement",
    metadata: {
      achievementCode: input.def.code,
      title: input.def.title,
    },
  });

  const now = new Date();
  const current = metricFor(input.def.code, input.metrics);
  try {
    await tx.insert(userAchievements).values({
      userId: input.userId,
      achievementCode: input.def.code,
      unlockedAt: now,
      rewardAzc: input.def.rewardAzc,
      progressSnapshot: {
        current,
        target: input.def.target,
        metrics: input.metrics,
      },
      rewardTransactionId: paid.transaction.id,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("user_achievements_user_code_unique")) {
      return null;
    }
    throw error;
  }

  await insertInbox(tx, {
    userId: input.userId,
    code: input.def.code,
    title: input.def.title,
    rewardAzc: input.def.rewardAzc,
  });
  await enqueueTelegramNotice(tx, {
    userId: input.userId,
    code: input.def.code,
    text: `Достижение «${input.def.title}»! +${input.def.rewardAzc.toString()} AZC`,
  });

  return {
    code: input.def.code,
    rewardAzc: input.def.rewardAzc.toString(),
    unlockedAt: now.toISOString(),
  };
}

export async function evaluateAchievementsIn(
  tx: GiftbotTx,
  userId: string,
): Promise<EvaluateAchievementsResult> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`achievement:${userId}`}))`,
  );

  // Ensure kick stats row exists so progress reads default to 0.
  await ensureKickStatsRow(tx, userId);

  const metrics = await loadMetrics(tx, userId);
  const unlocked = await tx
    .select({ code: userAchievements.achievementCode })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
  const unlockedSet = new Set(unlocked.map((row) => row.code));

  const granted: AchievementGrantResult[] = [];
  for (const code of GRANT_ORDER) {
    if (unlockedSet.has(code)) {
      continue;
    }
    const def = getAchievement(code);
    if (metricFor(code, metrics) < def.target) {
      continue;
    }
    const result = await grantAchievementIn(tx, { userId, def, metrics });
    if (result) {
      granted.push(result);
      unlockedSet.add(code);
    }
  }

  return { granted };
}

export async function evaluateAchievementsForUser(
  db: GiftbotDb,
  userId: string,
): Promise<EvaluateAchievementsResult> {
  return db.transaction((tx) => evaluateAchievementsIn(tx, userId));
}

export async function listAchievementsForUser(
  db: GiftbotDb,
  userId: string,
): Promise<AchievementListItem[]> {
  const metrics = await loadMetrics(db, userId);
  const unlockedRows = await db
    .select()
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
  const byCode = new Map(
    unlockedRows.map((row) => [row.achievementCode, row] as const),
  );

  return ACHIEVEMENT_CATALOG.map((def) => {
    const unlocked = byCode.get(def.code);
    const current = metricFor(def.code, metrics);
    const completed = Boolean(unlocked) || current >= def.target;
    return {
      code: def.code,
      title: def.title,
      description: def.description,
      emoji: def.emoji,
      rewardAzc: def.rewardAzc.toString(),
      current: Math.min(current, def.target),
      target: def.target,
      progress: progressRatio(current, def.target),
      completed,
      unlockedAt: unlocked?.unlockedAt.toISOString() ?? null,
    };
  });
}
