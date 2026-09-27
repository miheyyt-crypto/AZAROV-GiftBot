import {
  jobs,
  rollsBetOperations,
  rollsParticipants,
  rollsRounds,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { and, eq, sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import {
  aggregateRollsClientSeed,
  assertServerSeedHash,
  deriveRollsWinningTicket,
  hashRollsSnapshot,
  hashServerSeed,
  selectRollsWinner,
  verifyRollsRound,
  type RollsSnapshotEntry,
} from "./provably-fair.js";
import {
  ensureCurrentRollsRound,
  finishRollsSpin,
  lockAndSettleRollsRound,
  placeRollsBet,
  readRollsCurrent,
  ROLLS_COUNTDOWN_MS,
  ROLLS_MAX_PLAYERS,
  ROLLS_SPIN_MS,
} from "./rolls.js";
import { provisionUser } from "./user.js";
import { apply } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

async function fund(userId: string, amount: bigint, key: string): Promise<void> {
  await apply(harness.db, {
    userId,
    type: "deposit",
    amountMinor: amount,
    idempotencyKey: key,
    actorType: "system",
    reason: "test fund",
  });
}

async function balance(userId: string): Promise<bigint> {
  const rows = await harness.db
    .select({ b: wallets.balanceMinor })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return BigInt(rows[0]?.b ?? 0);
}

async function clearRolls(): Promise<void> {
  await harness.db.execute(sql`DELETE FROM rolls_bet_operations`);
  await harness.db.execute(sql`DELETE FROM rolls_participants`);
  await harness.db.execute(sql`DELETE FROM jobs WHERE type LIKE 'rolls.%'`);
  await harness.db.execute(sql`DELETE FROM rolls_rounds`);
}

test("rolls PF ticket ranges and verification are deterministic", () => {
  const entries: RollsSnapshotEntry[] = [
    { participantId: "pa", stake: "900", clientSeed: "ca" },
    { participantId: "pb", stake: "100", clientSeed: "cb" },
  ];
  assert.equal(selectRollsWinner(
    entries.map((e) => ({ participantId: e.participantId, stake: BigInt(e.stake) })),
    0n,
  ), "pa");
  assert.equal(selectRollsWinner(
    entries.map((e) => ({ participantId: e.participantId, stake: BigInt(e.stake) })),
    899n,
  ), "pa");
  assert.equal(selectRollsWinner(
    entries.map((e) => ({ participantId: e.participantId, stake: BigInt(e.stake) })),
    900n,
  ), "pb");
  assert.equal(selectRollsWinner(
    entries.map((e) => ({ participantId: e.participantId, stake: BigInt(e.stake) })),
    999n,
  ), "pb");

  const serverSeed = "fixed-server-seed-for-rolls-test";
  const serverSeedHash = hashServerSeed(serverSeed);
  assert.equal(assertServerSeedHash(serverSeed, serverSeedHash), true);
  const snapshotHash = hashRollsSnapshot(entries);
  const aggregate = aggregateRollsClientSeed(entries);
  const ticket = deriveRollsWinningTicket({
    serverSeed,
    roundId: "00000000-0000-4000-8000-000000000001",
    nonce: 7n,
    aggregateClientSeed: aggregate,
    snapshotHash,
    totalPot: 1000n,
  });
  const ticket2 = deriveRollsWinningTicket({
    serverSeed,
    roundId: "00000000-0000-4000-8000-000000000001",
    nonce: 7n,
    aggregateClientSeed: aggregate,
    snapshotHash,
    totalPot: 1000n,
  });
  assert.equal(ticket, ticket2);
  const winner = selectRollsWinner(
    entries.map((e) => ({ participantId: e.participantId, stake: BigInt(e.stake) })),
    ticket,
  );
  assert.equal(
    verifyRollsRound({
      serverSeed,
      serverSeedHash,
      roundId: "00000000-0000-4000-8000-000000000001",
      nonce: 7n,
      entries,
      totalPot: 1000n,
      winningTicket: ticket,
      winnerParticipantId: winner,
    }),
    true,
  );
  const otherTicket = deriveRollsWinningTicket({
    serverSeed: "other-seed",
    roundId: "00000000-0000-4000-8000-000000000001",
    nonce: 7n,
    aggregateClientSeed: aggregate,
    snapshotHash,
    totalPot: 1000n,
  });
  assert.notEqual(ticket, otherTicket);
});

test("rolls waiting then second player starts immutable countdown", async () => {
  await clearRolls();
  const a = await provisionUser(harness.db);
  const b = await provisionUser(harness.db);
  await fund(a.userId, 10_000n, `fund-ra-${a.userId}`);
  await fund(b.userId, 10_000n, `fund-rb-${b.userId}`);

  const first = await placeRollsBet(harness.db, {
    userId: a.userId,
    amountAzc: 900,
    clientSeed: "seed-a",
    idempotencyKey: "bet-a1",
  });
  assert.equal(first.round.status, "waiting");
  assert.equal(first.round.participantCount, 1);
  assert.equal(first.round.bettingDeadline, null);
  assert.equal(first.you.chancePercent, "100.00");

  const second = await placeRollsBet(harness.db, {
    userId: b.userId,
    amountAzc: 100,
    clientSeed: "seed-b",
    idempotencyKey: "bet-b1",
  });
  assert.equal(second.round.status, "betting");
  assert.equal(second.round.participantCount, 2);
  assert.ok(second.round.bettingDeadline);
  assert.equal(ROLLS_COUNTDOWN_MS, 20_000);
  assert.equal(ROLLS_SPIN_MS, 8_000);
  assert.notEqual(ROLLS_COUNTDOWN_MS, ROLLS_SPIN_MS);
  const remainingMs =
    Date.parse(second.round.bettingDeadline) - Date.now();
  assert.ok(
    remainingMs > 18_000 && remainingMs <= 20_000,
    `expected ~20s betting remaining, got ${remainingMs}ms`,
  );
  assert.ok(remainingMs > 8_000);
  const lockJobs = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, `rolls.lock_round:${second.round.roundId}`));
  assert.equal(lockJobs.length, 1);
  const lockWaitMs =
    lockJobs[0]!.nextAttemptAt.getTime() - Date.parse(second.round.bettingStartedAt!);
  assert.ok(lockWaitMs >= 19_000 && lockWaitMs <= 21_000);
  assert.equal(first.round.totalPotAzc, "900");
  assert.equal(second.round.totalPotAzc, "1000");
  assert.equal(second.you.chancePercent, "10.00");

  const deadline = second.round.bettingDeadline;
  const topUp = await placeRollsBet(harness.db, {
    userId: b.userId,
    amountAzc: 900,
    clientSeed: "ignored",
    idempotencyKey: "bet-b2",
  });
  assert.equal(topUp.round.bettingDeadline, deadline);
  assert.equal(topUp.round.totalPotAzc, "1900");
  assert.equal(topUp.you.stakeAzc, "1000");
});

test("rolls bet idempotency and concurrent top-up stake cap", async () => {
  await clearRolls();
  const user = await provisionUser(harness.db);
  await fund(user.userId, 1_000n, `fund-rc-${user.userId}`);
  const other = await provisionUser(harness.db);
  await fund(other.userId, 1_000n, `fund-ro-${other.userId}`);

  await placeRollsBet(harness.db, {
    userId: other.userId,
    amountAzc: 100,
    clientSeed: "o",
    idempotencyKey: "o1",
  });
  await placeRollsBet(harness.db, {
    userId: user.userId,
    amountAzc: 100,
    clientSeed: "u",
    idempotencyKey: "u-init",
  });

  const replay = await placeRollsBet(harness.db, {
    userId: user.userId,
    amountAzc: 100,
    clientSeed: "u",
    idempotencyKey: "u-init",
  });
  assert.equal(replay.replayed, true);
  assert.equal(await balance(user.userId), 900n);

  const before = await balance(user.userId);
  const [r1, r2] = await Promise.allSettled([
    placeRollsBet(harness.db, {
      userId: user.userId,
      amountAzc: 700,
      clientSeed: "u",
      idempotencyKey: "u-c1",
    }),
    placeRollsBet(harness.db, {
      userId: user.userId,
      amountAzc: 700,
      clientSeed: "u",
      idempotencyKey: "u-c2",
    }),
  ]);
  const ok = [r1, r2].filter((r) => r.status === "fulfilled").length;
  const fail = [r1, r2].filter((r) => r.status === "rejected").length;
  assert.equal(ok, 1);
  assert.equal(fail, 1);
  assert.equal(await balance(user.userId), before - 700n);
  assert.ok((await balance(user.userId)) >= 0n);
});

test("rolls lock settles full pot once and creates next waiting round", async () => {
  await clearRolls();
  const a = await provisionUser(harness.db);
  const b = await provisionUser(harness.db);
  await fund(a.userId, 5_000n, `fund-rl-a-${a.userId}`);
  await fund(b.userId, 5_000n, `fund-rl-b-${b.userId}`);

  await placeRollsBet(harness.db, {
    userId: a.userId,
    amountAzc: 900,
    clientSeed: "a",
    idempotencyKey: "lock-a",
  });
  const started = await placeRollsBet(harness.db, {
    userId: b.userId,
    amountAzc: 100,
    clientSeed: "b",
    idempotencyKey: "lock-b",
  });
  await harness.db
    .update(rollsRounds)
    .set({ bettingDeadline: new Date(Date.now() - 1000) })
    .where(eq(rollsRounds.id, started.round.roundId));

  const balA = await balance(a.userId);
  const balB = await balance(b.userId);
  const settled = await lockAndSettleRollsRound(harness.db, started.round.roundId);
  assert.equal(settled.settled, true);
  const again = await lockAndSettleRollsRound(harness.db, started.round.roundId);
  assert.equal(again.settled, true);

  const round = (
    await harness.db
      .select()
      .from(rollsRounds)
      .where(eq(rollsRounds.id, started.round.roundId))
      .limit(1)
  )[0]!;
  assert.equal(round.status, "spinning");
  assert.equal(round.spinDurationMs, ROLLS_SPIN_MS);
  assert.equal(ROLLS_SPIN_MS, 8000);
  assert.ok(round.spinStartedAt);
  const finishJobs = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, `rolls.finish_spin:${round.id}`));
  assert.equal(finishJobs.length, 1);
  const waitMs =
    finishJobs[0]!.nextAttemptAt.getTime() - round.spinStartedAt.getTime();
  assert.ok(waitMs >= 7_900 && waitMs <= 8_100);
  assert.equal(BigInt(round.payoutAzc ?? 0), 1000n);
  assert.ok(round.winnerUserId);
  assert.equal(round.serverSeedHash.length, 64);

  const wins = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.type, "rolls_win"),
        eq(walletTransactions.referenceId, round.id),
      ),
    );
  assert.equal(wins.length, 1);
  assert.equal(BigInt(wins[0]!.amountMinor), 1000n);

  const winnerBal =
    round.winnerUserId === a.userId ? await balance(a.userId) : await balance(b.userId);
  const loserBal =
    round.winnerUserId === a.userId ? await balance(b.userId) : await balance(a.userId);
  if (round.winnerUserId === a.userId) {
    assert.equal(winnerBal, balA + 1000n);
    assert.equal(loserBal, balB);
  } else {
    assert.equal(winnerBal, balB + 1000n);
    assert.equal(loserBal, balA);
  }

  await finishRollsSpin(harness.db, round.id);
  await finishRollsSpin(harness.db, round.id);
  const resolved = (
    await harness.db
      .select()
      .from(rollsRounds)
      .where(eq(rollsRounds.id, round.id))
      .limit(1)
  )[0]!;
  assert.equal(resolved.status, "resolved");
  assert.ok(resolved.serverSeed);

  const current = await readRollsCurrent(harness.db, a.userId);
  assert.equal(current.round.status, "waiting");
  assert.notEqual(current.round.roundId, round.id);
  assert.ok(current.previous);
  assert.equal(current.previous.winnerId, round.winnerUserId);
  assert.equal(current.previous.roundId, round.id);
  assert.equal(current.previous.amount, "1000");
  assert.notEqual(current.previous.winnerName, "Вы");
  assert.ok(current.previous.winnerInitials);
  assert.ok(current.top);
  assert.equal(current.top.roundId, round.id);
  const asLoser = await readRollsCurrent(harness.db, b.userId);
  assert.equal(asLoser.previous?.winnerId, round.winnerUserId);
  assert.equal(asLoser.previous?.winnerName, current.previous.winnerName);

  const [againA, againB] = await Promise.all([
    ensureCurrentRollsRound(harness.db),
    ensureCurrentRollsRound(harness.db),
  ]);
  assert.equal(againA.id, againB.id);
  assert.equal(againA.id, current.round.roundId);
  assert.equal(againA.status, "waiting");
});

test("rolls concurrent bet burst keeps wallets non-negative", async () => {
  await clearRolls();
  const users = [];
  for (let i = 0; i < 50; i += 1) {
    const u = await provisionUser(harness.db);
    await fund(u.userId, 500n, `fund-burst-${u.userId}`);
    users.push(u);
  }
  const results = await Promise.allSettled(
    users.flatMap((u, i) => [
      placeRollsBet(harness.db, {
        userId: u.userId,
        amountAzc: 100,
        clientSeed: `c${i}`,
        idempotencyKey: `burst-a-${u.userId}`,
      }),
      placeRollsBet(harness.db, {
        userId: u.userId,
        amountAzc: 100,
        clientSeed: `c${i}`,
        idempotencyKey: `burst-b-${u.userId}`,
      }),
    ]),
  );
  assert.equal(results.length, 100);
  for (const u of users) {
    assert.ok((await balance(u.userId)) >= 0n);
  }
  const round = await ensureCurrentRollsRound(harness.db);
  const parts = await harness.db
    .select({ c: sql<string>`count(*)::text` })
    .from(rollsParticipants)
    .where(eq(rollsParticipants.roundId, round.id));
  assert.ok(Number(parts[0]?.c ?? 0) <= 50);
  assert.ok(Number(parts[0]?.c ?? 0) >= 2);
});

test("rolls max players race keeps unique participants <= 1000", async () => {
  await clearRolls();
  const round = await ensureCurrentRollsRound(harness.db);
  await harness.db.execute(sql`
    WITH created AS (
      INSERT INTO users (id, public_id, status)
      SELECT gen_random_uuid(), gen_random_uuid(), 'active'
      FROM generate_series(1, 999)
      RETURNING id, public_id
    )
    INSERT INTO rolls_participants (
      round_id, user_id, public_id, display_name, total_stake, client_seed
    )
    SELECT ${round.id}::uuid, id, public_id::text, 'P', 100, 'c'
    FROM created
  `);
  await harness.db
    .update(rollsRounds)
    .set({
      participantCount: 999,
      totalPot: 999n * 100n,
      status: "betting",
      bettingDeadline: new Date(Date.now() + 60_000),
      bettingStartedAt: new Date(),
    })
    .where(eq(rollsRounds.id, round.id));

  const x = await provisionUser(harness.db);
  const y = await provisionUser(harness.db);
  await fund(x.userId, 500n, `fund-mx-${x.userId}`);
  await fund(y.userId, 500n, `fund-my-${y.userId}`);
  const [rx, ry] = await Promise.allSettled([
    placeRollsBet(harness.db, {
      userId: x.userId,
      amountAzc: 100,
      clientSeed: "x",
      idempotencyKey: "mx",
    }),
    placeRollsBet(harness.db, {
      userId: y.userId,
      amountAzc: 100,
      clientSeed: "y",
      idempotencyKey: "my",
    }),
  ]);
  const ok = [rx, ry].filter((r) => r.status === "fulfilled").length;
  const fail = [rx, ry].filter((r) => r.status === "rejected").length;
  assert.equal(ok, 1);
  assert.equal(fail, 1);
  const count = await harness.db
    .select({ c: sql<string>`count(*)::text` })
    .from(rollsParticipants)
    .where(eq(rollsParticipants.roundId, round.id));
  assert.equal(Number(count[0]?.c ?? 0), ROLLS_MAX_PLAYERS);
  void rollsBetOperations;
  void jobs;
});

test("rolls 1000 participants lock and settle pot conservation", async () => {
  await clearRolls();
  const round = await ensureCurrentRollsRound(harness.db);
  await harness.db.execute(sql`
    WITH created AS (
      INSERT INTO users (id, public_id, status)
      SELECT gen_random_uuid(), gen_random_uuid(), 'active'
      FROM generate_series(1, 1000)
      RETURNING id, public_id
    ),
    wallets_ins AS (
      INSERT INTO wallets (user_id, balance_minor, status)
      SELECT id, 0, 'active' FROM created
      RETURNING user_id
    )
    INSERT INTO rolls_participants (
      round_id, user_id, public_id, display_name, total_stake, client_seed
    )
    SELECT ${round.id}::uuid, id, public_id::text, 'U', 100, 'seed'
    FROM created
  `);
  const pot = 1000n * 100n;
  await harness.db
    .update(rollsRounds)
    .set({
      participantCount: 1000,
      totalPot: pot,
      status: "betting",
      bettingDeadline: new Date(Date.now() - 1),
      bettingStartedAt: new Date(Date.now() - 20_000),
    })
    .where(eq(rollsRounds.id, round.id));

  const settled = await lockAndSettleRollsRound(harness.db, round.id);
  assert.equal(settled.settled, true);
  const locked = (
    await harness.db.select().from(rollsRounds).where(eq(rollsRounds.id, round.id)).limit(1)
  )[0]!;
  assert.equal(locked.participantCount, 1000);
  assert.equal(BigInt(locked.totalPot), pot);
  assert.equal(BigInt(locked.payoutAzc ?? 0), pot);
  assert.ok(locked.winnerParticipantId);
  assert.ok(locked.winningTicket != null);
  assert.ok(BigInt(locked.winningTicket!) >= 0n);
  assert.ok(BigInt(locked.winningTicket!) < pot);

  const winRows = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.type, "rolls_win"),
        eq(walletTransactions.referenceId, round.id),
      ),
    );
  assert.equal(winRows.length, 1);
  assert.equal(BigInt(winRows[0]!.amountMinor), pot);
});
