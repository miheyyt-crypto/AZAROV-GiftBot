import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  diceRounds,
  minesGames,
  notifications,
  rollsParticipants,
  rollsRounds,
  userAchievements,
  userKickStats,
  userProgress,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { and, eq } from "drizzle-orm";
import {
  ACHIEVEMENT_CATALOG,
  evaluateAchievementsForUser,
  listAchievementsForUser,
} from "./achievements.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { xpToReachLevel } from "./level.js";
import { asBigInt } from "./money.js";
import { apply } from "./wallet.js";
import { provisionUser } from "./user.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("achievement catalog is exactly 5 with fixed rewards", () => {
  assert.equal(ACHIEVEMENT_CATALOG.length, 5);
  assert.deepEqual(
    ACHIEVEMENT_CATALOG.map((row) => ({
      code: row.code,
      title: row.title,
      description: row.description,
      emoji: row.emoji,
      target: row.target,
      rewardAzc: row.rewardAzc.toString(),
    })),
    [
      {
        code: "kick_100_messages",
        title: "Первые шаги",
        description: "Напиши 100 сообщений в чате Kick во время стримов",
        emoji: "💬",
        target: 100,
        rewardAzc: "500",
      },
      {
        code: "referrals_5_active",
        title: "Своя компания",
        description: "Пригласи 5 активных друзей",
        emoji: "👥",
        target: 5,
        rewardAzc: "2500",
      },
      {
        code: "games_100_total",
        title: "Игрок",
        description: "Сыграй 100 игр",
        emoji: "🎮",
        target: 100,
        rewardAzc: "3000",
      },
      {
        code: "cases_25_opened",
        title: "Любитель кейсов",
        description: "Открой 25 кейсов",
        emoji: "🎁",
        target: 25,
        rewardAzc: "5000",
      },
      {
        code: "level_10",
        title: "Преданный зритель",
        description: "Достигни 10 уровня",
        emoji: "⭐",
        target: 10,
        rewardAzc: "10000",
      },
    ],
  );
});

test("listAchievementsForUser reports progress thresholds", async () => {
  const user = await provisionUser(harness.db);
  await harness.db.insert(userKickStats).values({
    userId: user.userId,
    chatMessagesCounted: 37n,
  });
  await harness.db.insert(userProgress).values({
    userId: user.userId,
    totalXp: xpToReachLevel(4),
  });

  const list = await listAchievementsForUser(harness.db, user.userId);
  assert.equal(list.length, 5);
  const kick = list.find((row) => row.code === "kick_100_messages");
  assert.ok(kick);
  assert.equal(kick.current, 37);
  assert.equal(kick.target, 100);
  assert.equal(kick.completed, false);
  assert.equal(kick.unlockedAt, null);
  assert.ok(kick.progress > 0.3 && kick.progress < 0.4);

  const level = list.find((row) => row.code === "level_10");
  assert.ok(level);
  assert.equal(level.current, 4);
  assert.equal(level.target, 10);
  assert.equal(level.completed, false);
});

test("evaluateAchievementsForUser is idempotent across 10 reconciles", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 1n,
    idempotencyKey: `ach-seed:${user.userId}`,
    actorType: "system",
  });
  await harness.db.insert(userKickStats).values({
    userId: user.userId,
    chatMessagesCounted: 100n,
  });

  const first = await evaluateAchievementsForUser(harness.db, user.userId);
  assert.equal(first.granted.length, 1);
  assert.equal(first.granted[0]?.code, "kick_100_messages");

  for (let i = 0; i < 10; i += 1) {
    const again = await evaluateAchievementsForUser(harness.db, user.userId);
    assert.equal(again.granted.length, 0);
  }

  const rewards = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.type, "achievement_reward"),
      ),
    );
  assert.equal(rewards.length, 1);
  assert.equal(asBigInt(rewards[0]!.amountMinor), 500n);
  assert.equal(rewards[0]!.reason, "Достижение: Первые шаги");
  assert.equal(
    rewards[0]!.idempotencyKey,
    `achievement.reward:${user.userId}:kick_100_messages`,
  );

  const unlocked = await harness.db
    .select()
    .from(userAchievements)
    .where(eq(userAchievements.userId, user.userId));
  assert.equal(unlocked.length, 1);

  const inbox = await harness.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user.userId),
        eq(notifications.type, "achievement_unlocked"),
      ),
    );
  assert.equal(inbox.length, 1);

  const wallet = await harness.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.userId))
    .limit(1);
  assert.equal(asBigInt(wallet[0]!.balanceMinor), 501n);
});

test("games_100_total counts mines resolved + dice + rolls resolved participation", async () => {
  const user = await provisionUser(harness.db);

  await harness.db.insert(minesGames).values([
    {
      userId: user.userId,
      status: "cashed_out",
      betAzc: 100n,
      mineCount: 3,
      minePositions: [0, 1, 2],
      revealedCells: [3],
      safePickCount: 1,
      currentMultiplier: "1.05",
      payoutAzc: 105n,
      clientSeed: "c1",
      serverSeed: "s1",
      serverSeedHash: "h1",
      nonce: 0n,
      startIdempotencyKey: `mines-a:${user.userId}`,
      resolvedAt: new Date(),
    },
    {
      userId: user.userId,
      status: "lost",
      betAzc: 100n,
      mineCount: 3,
      minePositions: [0, 1, 2],
      revealedCells: [0],
      safePickCount: 0,
      payoutAzc: 0n,
      clientSeed: "c2",
      serverSeed: "s2",
      serverSeedHash: "h2",
      nonce: 1n,
      startIdempotencyKey: `mines-b:${user.userId}`,
      resolvedAt: new Date(),
    },
    {
      userId: user.userId,
      status: "active",
      betAzc: 100n,
      mineCount: 3,
      minePositions: [0, 1, 2],
      revealedCells: [],
      safePickCount: 0,
      clientSeed: "c3",
      serverSeed: "s3",
      serverSeedHash: "h3",
      nonce: 2n,
      startIdempotencyKey: `mines-c:${user.userId}`,
    },
  ]);

  await harness.db.insert(diceRounds).values({
    userId: user.userId,
    betAzc: 100n,
    chance: 50,
    rawResult: 10_000,
    win: false,
    payoutAzc: 0n,
    clientSeed: "d1",
    serverSeed: "ds1",
    serverSeedHash: "dh1",
    nonce: 0n,
    playIdempotencyKey: `dice-a:${user.userId}`,
  });

  const roundA = await harness.db
    .insert(rollsRounds)
    .values({
      status: "resolved",
      serverSeed: "rs1",
      serverSeedHash: "rh1",
      nonce: 0n,
      resolvedAt: new Date(),
    })
    .returning();
  const roundB = await harness.db
    .insert(rollsRounds)
    .values({
      status: "betting",
      serverSeed: "rs2",
      serverSeedHash: "rh2",
      nonce: 1n,
    })
    .returning();
  await harness.db.insert(rollsParticipants).values([
    {
      roundId: roundA[0]!.id,
      userId: user.userId,
      publicId: "p1",
      displayName: "Player",
      totalStake: 100n,
      clientSeed: "rc1",
    },
    {
      roundId: roundB[0]!.id,
      userId: user.userId,
      publicId: "p1",
      displayName: "Player",
      totalStake: 100n,
      clientSeed: "rc2",
    },
  ]);

  const list = await listAchievementsForUser(harness.db, user.userId);
  const games = list.find((row) => row.code === "games_100_total");
  assert.ok(games);
  // 2 resolved mines + 1 dice + 1 resolved rolls participation = 4
  assert.equal(games.current, 4);
  assert.equal(games.completed, false);
});

test("concurrent evaluate around kick 99→101 unlocks once", async () => {
  const user = await provisionUser(harness.db);
  await harness.db.insert(userKickStats).values({
    userId: user.userId,
    chatMessagesCounted: 99n,
  });

  const results = await Promise.all([
    harness.db.transaction(async (tx) => {
      await tx
        .update(userKickStats)
        .set({ chatMessagesCounted: 100n, updatedAt: new Date() })
        .where(eq(userKickStats.userId, user.userId));
      const { evaluateAchievementsIn } = await import("./achievements.js");
      return evaluateAchievementsIn(tx, user.userId);
    }),
    harness.db.transaction(async (tx) => {
      await tx
        .update(userKickStats)
        .set({ chatMessagesCounted: 101n, updatedAt: new Date() })
        .where(eq(userKickStats.userId, user.userId));
      const { evaluateAchievementsIn } = await import("./achievements.js");
      return evaluateAchievementsIn(tx, user.userId);
    }),
  ]);

  const grantedTotal = results.reduce(
    (sum, row) => sum + row.granted.length,
    0,
  );
  assert.equal(grantedTotal, 1);
  assert.ok(
    results.some((row) =>
      row.granted.some((g) => g.code === "kick_100_messages"),
    ),
  );

  const rewards = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.type, "achievement_reward"),
      ),
    );
  assert.equal(rewards.length, 1);
  assert.equal(asBigInt(rewards[0]!.amountMinor), 500n);

  const unlocked = await harness.db
    .select()
    .from(userAchievements)
    .where(
      and(
        eq(userAchievements.userId, user.userId),
        eq(userAchievements.achievementCode, "kick_100_messages"),
      ),
    );
  assert.equal(unlocked.length, 1);
});

test("level_10 unlocks at xp threshold with full reward", async () => {
  const user = await provisionUser(harness.db);
  await harness.db.insert(userProgress).values({
    userId: user.userId,
    totalXp: xpToReachLevel(10),
  });

  const granted = await evaluateAchievementsForUser(harness.db, user.userId);
  assert.ok(granted.granted.some((row) => row.code === "level_10"));

  const reward = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.type, "achievement_reward"),
        eq(
          walletTransactions.idempotencyKey,
          `achievement.reward:${user.userId}:level_10`,
        ),
      ),
    );
  assert.equal(reward.length, 1);
  assert.equal(asBigInt(reward[0]!.amountMinor), 10_000n);
  assert.equal(reward[0]!.reason, "Достижение: Преданный зритель");

  const list = await listAchievementsForUser(harness.db, user.userId);
  const level = list.find((row) => row.code === "level_10");
  assert.ok(level);
  assert.equal(level.completed, true);
  assert.ok(level.unlockedAt);
});
