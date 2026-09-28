import {
  jobs,
  kickAccounts,
  notifications,
  referralContestResults,
  referralContests,
  referrals,
  telegramAccounts,
  users,
  walletTransactions,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { InvalidAmountError } from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { linkKickAccount } from "./kick.js";
import {
  REFERRAL_CONTEST_DEFAULT_PRIZES,
  REFERRAL_CONTEST_DURATION_MS,
  REFERRAL_CONTEST_FIRST_PLACE_MAX_AZC,
  REFERRAL_CONTEST_LEADERBOARD_LIMIT,
  REFERRAL_CONTEST_MIN_ACTIVE_REFERRALS_FOR_REWARD,
  REFERRAL_CONTEST_PRIZE_PLACES,
  REFERRAL_CONTEST_PRIZE_POOL_AZC,
  ensureDefaultReferralContest,
  finalizeReferralContest,
  invalidateReferralContestCache,
  parsePrizeDistribution,
  readReferralContestHomeSummary,
} from "./referral-contest.js";
import { grantManualReferralCredit } from "./referral-manual.js";
import {
  activateReferralIfEligible,
  attributeReferral,
  countActivatedReferrals,
  onKickAccountLinked,
  readReferralMe,
} from "./referral.js";
import { asBigInt } from "./money.js";
import { provisionUser } from "./user.js";

const TEST_PRIZES = [...REFERRAL_CONTEST_DEFAULT_PRIZES];

let harness: DomainHarness;
let kickSeq = 0;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

async function resetContests(): Promise<void> {
  await harness.db.delete(referralContestResults);
  await harness.db.delete(referralContests);
  invalidateReferralContestCache();
}

async function startContest(startAt: Date) {
  await resetContests();
  return ensureDefaultReferralContest(harness.db, {
    clock: { now: () => startAt },
  });
}

async function activateFor(
  referrerCode: string,
  refereeUserId: string,
  activatedAt?: Date,
): Promise<void> {
  await attributeReferral(harness.db, {
    refereeUserId,
    code: referrerCode,
  });
  kickSeq += 1;
  await linkKickAccount(harness.db, {
    userId: refereeUserId,
    kickUserId: `contest-kick-${kickSeq}-${refereeUserId.slice(0, 8)}`,
  });
  await onKickAccountLinked(harness.db, refereeUserId);
  if (activatedAt) {
    await harness.db
      .update(referrals)
      .set({ activatedAt })
      .where(eq(referrals.refereeUserId, refereeUserId));
  }
}

async function activateMany(
  referrerCode: string,
  count: number,
  activatedAt: Date,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const ref = await provisionUser(harness.db);
    await activateFor(referrerCode, ref.userId, activatedAt);
  }
}

test("prize distribution must have five places summing to 150000", () => {
  const ok = parsePrizeDistribution(TEST_PRIZES);
  assert.equal(ok.length, REFERRAL_CONTEST_PRIZE_PLACES);
  assert.equal(ok[0]?.rewardAzc, REFERRAL_CONTEST_FIRST_PLACE_MAX_AZC);
  assert.equal(ok.map((row) => row.rewardAzc.toString()).join(","), "50000,34000,30000,20000,16000");
  assert.equal(
    ok.reduce((sum, row) => sum + row.rewardAzc, 0n),
    REFERRAL_CONTEST_PRIZE_POOL_AZC,
  );
  assert.equal(REFERRAL_CONTEST_MIN_ACTIVE_REFERRALS_FOR_REWARD, 5);
  assert.throws(
    () => parsePrizeDistribution([...TEST_PRIZES, { place: 6, rewardAzc: "1000" }]),
    InvalidAmountError,
  );
  assert.throws(
    () =>
      parsePrizeDistribution(
        TEST_PRIZES.map((row) => {
          if (row.place === 1) {
            return { ...row, rewardAzc: "50001" };
          }
          if (row.place === 5) {
            return { ...row, rewardAzc: "15999" };
          }
          return row;
        }),
      ),
    InvalidAmountError,
  );
});

test("only activated real referrals in the contest window count", async () => {
  const start = new Date("2026-09-01T00:00:00.000Z");
  const created = await startContest(start);
  const a = await provisionUser(harness.db, { displayName: "A" });
  const b = await provisionUser(harness.db, { displayName: "B" });
  const inside = await provisionUser(harness.db);
  const before = await provisionUser(harness.db);
  const after = await provisionUser(harness.db);
  const unlinked = await provisionUser(harness.db);

  await activateFor(
    a.referralCode,
    inside.userId,
    new Date("2026-09-01T12:00:00.000Z"),
  );
  await activateFor(
    a.referralCode,
    before.userId,
    new Date("2025-12-01T00:00:00.000Z"),
  );
  await activateFor(
    a.referralCode,
    after.userId,
    new Date("2026-09-10T00:00:00.000Z"),
  );
  await attributeReferral(harness.db, {
    refereeUserId: unlinked.userId,
    code: a.referralCode,
  });
  const idle = await activateReferralIfEligible(harness.db, unlinked.userId);
  assert.equal(idle.activated, false);

  await grantManualReferralCredit(harness.db, {
    userId: b.userId,
    amount: 25,
    idempotencyKey: `manual-contest-${b.userId}`,
  });

  invalidateReferralContestCache();
  const page = await readReferralContestHomeSummary(harness.db, {
    userId: a.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-09-01T18:00:00.000Z") },
  });
  assert.ok(page.contest);
  assert.equal(page.contest.id, created.id);
  assert.equal(page.contest.prizes.length, 5);
  assert.equal(page.me.referralCount, 1);
  const pageB = await readReferralContestHomeSummary(harness.db, {
    userId: b.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-09-01T18:00:00.000Z") },
  });
  assert.equal(pageB.me.referralCount, 0);
  const friends = await readReferralMe(harness.db, {
    userId: b.userId,
    botUsername: "giftbot",
  });
  assert.ok(friends.stats.active >= 25);
  const real = await countActivatedReferrals(harness.db, b.userId);
  assert.equal(real, 0);
});

test("activated referral without active Kick does not count", async () => {
  await startContest(new Date("2026-09-01T00:00:00.000Z"));
  const a = await provisionUser(harness.db, { displayName: "A-kickless" });
  const ref = await provisionUser(harness.db);
  await activateFor(
    a.referralCode,
    ref.userId,
    new Date("2026-09-01T12:00:00.000Z"),
  );
  await harness.db
    .update(kickAccounts)
    .set({ status: "revoked" })
    .where(eq(kickAccounts.userId, ref.userId));
  invalidateReferralContestCache();
  const page = await readReferralContestHomeSummary(harness.db, {
    userId: a.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-09-01T18:00:00.000Z") },
  });
  assert.equal(page.me.referralCount, 0);
});

test("attributed-only referrals do not count toward contest score", async () => {
  await startContest(new Date("2026-09-01T00:00:00.000Z"));
  const a = await provisionUser(harness.db);
  for (let i = 0; i < 6; i += 1) {
    const idle = await provisionUser(harness.db);
    await attributeReferral(harness.db, {
      refereeUserId: idle.userId,
      code: a.referralCode,
    });
  }
  await activateMany(a.referralCode, 4, new Date("2026-09-01T12:00:00.000Z"));
  invalidateReferralContestCache();
  const page = await readReferralContestHomeSummary(harness.db, {
    userId: a.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-09-01T18:00:00.000Z") },
  });
  assert.equal(page.me.referralCount, 4);
  assert.equal(page.me.rank, 1);
  assert.equal(page.me.potentialRewardAzc, null);
});

test("deterministic tie-break uses earlier score_reached_at then user id", async () => {
  await startContest(new Date("2026-09-02T00:00:00.000Z"));
  const early = await provisionUser(harness.db, { displayName: "early" });
  const late = await provisionUser(harness.db, { displayName: "late" });
  const r1 = await provisionUser(harness.db);
  const r2 = await provisionUser(harness.db);
  await activateFor(
    early.referralCode,
    r1.userId,
    new Date("2026-09-02T01:00:00.000Z"),
  );
  await activateFor(
    late.referralCode,
    r2.userId,
    new Date("2026-09-02T02:00:00.000Z"),
  );
  invalidateReferralContestCache();
  const page = await readReferralContestHomeSummary(harness.db, {
    userId: early.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-09-02T03:00:00.000Z") },
  });
  assert.ok(page.contest);
  assert.equal(page.leaderboard[0]?.isYou, true);
  assert.equal(page.leaderboard[0]?.referralCount, 1);
  assert.equal(page.me.rank, 1);
  const latePage = await readReferralContestHomeSummary(harness.db, {
    userId: late.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-09-02T03:00:00.000Z") },
  });
  assert.equal(latePage.me.rank, 2);
});

test("home summary includes prizes, TOP 5 and me", async () => {
  const created = await startContest(new Date("2026-09-03T00:00:00.000Z"));
  invalidateReferralContestCache();
  const summary = await readReferralContestHomeSummary(harness.db, {
    userId: (await provisionUser(harness.db)).userId,
    referralUrl: "https://t.me/AZAROV_GiftBot?start=x",
    clock: { now: () => new Date("2026-09-03T01:00:00.000Z") },
  });
  assert.ok(summary.contest);
  assert.equal(summary.contest.id, created.id);
  assert.equal(summary.contest.prizes.length, 5);
  assert.ok(Array.isArray(summary.leaderboard));
  assert.equal(summary.me.referralUrl, "https://t.me/AZAROV_GiftBot?start=x");
});

test("ensureDefaultReferralContest creates once and restart keeps the timer", async () => {
  await resetContests();
  const start = new Date("2026-04-01T00:00:00.000Z");
  const first = await ensureDefaultReferralContest(harness.db, {
    clock: { now: () => start },
  });
  const later = new Date("2026-04-01T06:00:00.000Z");
  const [a, b] = await Promise.all([
    ensureDefaultReferralContest(harness.db, { clock: { now: () => later } }),
    ensureDefaultReferralContest(harness.db, { clock: { now: () => later } }),
  ]);
  assert.equal(a.id, first.id);
  assert.equal(b.id, first.id);
  assert.equal(a.startAt, first.startAt);
  assert.equal(a.endAt, first.endAt);
  assert.equal(
    Date.parse(a.endAt) - Date.parse(a.startAt),
    REFERRAL_CONTEST_DURATION_MS,
  );
  const rows = await harness.db.select().from(referralContests);
  assert.equal(rows.length, 1);
});

test("finalization pays five eligible winners once and freezes later referrals", async () => {
  const start = new Date("2026-08-01T00:00:00.000Z");
  const created = await startContest(start);
  const p0 = await provisionUser(harness.db, { displayName: "p0" });
  await harness.db.insert(telegramAccounts).values({
    userId: p0.userId,
    telegramUserId: BigInt(910000111),
    firstName: "winner",
    username: "winner0",
  });
  const players = [p0];
  for (let i = 1; i < 6; i += 1) {
    players.push(await provisionUser(harness.db, { displayName: `p${i}` }));
  }
  const counts = [9, 8, 7, 6, 5, 4];
  for (let i = 0; i < players.length; i += 1) {
    await activateMany(
      players[i]!.referralCode,
      counts[i]!,
      new Date(`2026-08-01T${String(i).padStart(2, "0")}:00:00.000Z`),
    );
  }

  invalidateReferralContestCache();
  const live = await readReferralContestHomeSummary(harness.db, {
    userId: players[0]!.userId,
    referralUrl: "https://t.me/AZAROV_GiftBot?start=x",
    clock: { now: () => new Date("2026-08-01T12:00:00.000Z") },
  });
  assert.ok(live.contest);
  assert.ok(live.leaderboard.length <= REFERRAL_CONTEST_LEADERBOARD_LIMIT);
  assert.equal(live.contest.prizes.length, 5);
  assert.equal(live.me.rank, 1);
  assert.equal(live.me.potentialRewardAzc, "50000");
  assert.equal(live.leaderboard[4]?.referralCount, 5);
  assert.equal(live.leaderboard[4]?.rewardAzc, "16000");

  const first = await finalizeReferralContest(harness.db, created.id, {
    now: new Date("2026-08-02T00:00:00.000Z"),
  });
  assert.equal(first.replayed, false);
  assert.equal(first.winnerCount, 5);

  const replay = await finalizeReferralContest(harness.db, created.id, {
    now: new Date("2026-08-02T01:00:00.000Z"),
  });
  assert.equal(replay.replayed, true);

  const extra = await provisionUser(harness.db);
  await activateFor(
    players[4]!.referralCode,
    extra.userId,
    new Date("2026-08-03T00:00:00.000Z"),
  );
  const frozenRows = await harness.db
    .select()
    .from(referralContestResults)
    .where(eq(referralContestResults.contestId, created.id));
  assert.equal(frozenRows.length, 6);
  const fifth = frozenRows.find((row) => row.userId === players[4]!.userId);
  const sixth = frozenRows.find((row) => row.userId === players[5]!.userId);
  assert.equal(fifth?.place, 5);
  assert.equal(fifth?.referralCount, 5);
  assert.equal(asBigInt(fifth?.rewardAzc ?? 0), 16000n);
  assert.equal(sixth?.place, 6);
  assert.equal(sixth?.referralCount, 4);
  assert.equal(asBigInt(sixth?.rewardAzc ?? 0), 0n);

  const frozen = await readReferralContestHomeSummary(harness.db, {
    userId: players[4]!.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-08-03T00:00:00.000Z") },
  });
  assert.equal(frozen.contest?.status, "finalized");
  assert.equal(frozen.me.referralCount, 5);

  const txs = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.type, "referral_contest_reward"));
  const forContest = txs.filter((row) => row.referenceId === created.id);
  assert.equal(forContest.length, 5);
  const sum = forContest.reduce((acc, row) => acc + asBigInt(row.amountMinor), 0n);
  assert.equal(sum, REFERRAL_CONTEST_PRIZE_POOL_AZC);

  const inbox = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.type, "referral_contest_reward"));
  const inboxFor = inbox.filter((row) => {
    const payload = row.payload as { contestId?: string };
    return payload.contestId === created.id;
  });
  assert.equal(inboxFor.length, 5);

  const tgJobs = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.type, "telegram.send_message"));
  const contestJobs = tgJobs.filter((row) =>
    String(row.idempotencyKey).includes(`referral-contest:${created.id}`),
  );
  assert.equal(contestJobs.length, 1);

  await finalizeReferralContest(harness.db, created.id);
  const tgAfter = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.type, "telegram.send_message"));
  const afterJobs = tgAfter.filter((row) =>
    String(row.idempotencyKey).includes(`referral-contest:${created.id}`),
  );
  assert.equal(afterJobs.length, 1);
});

test("fifth place with 4 active referrals stays ranked and is unpaid", async () => {
  const created = await startContest(new Date("2026-05-01T00:00:00.000Z"));
  const counts = [8, 7, 6, 5, 4];
  const players: Array<Awaited<ReturnType<typeof provisionUser>>> = [];
  for (let i = 0; i < counts.length; i += 1) {
    const player = await provisionUser(harness.db, { displayName: `min-${i}` });
    players.push(player);
    await activateMany(
      player.referralCode,
      counts[i]!,
      new Date(`2026-05-01T${String(i).padStart(2, "0")}:10:00.000Z`),
    );
  }
  const paid = await finalizeReferralContest(harness.db, created.id, {
    now: new Date("2026-05-02T00:00:00.000Z"),
  });
  assert.equal(paid.winnerCount, 4);
  const results = await harness.db
    .select()
    .from(referralContestResults)
    .where(eq(referralContestResults.contestId, created.id));
  const fifth = results.find((row) => row.userId === players[4]!.userId);
  assert.equal(fifth?.place, 5);
  assert.equal(fifth?.referralCount, 4);
  assert.equal(asBigInt(fifth?.rewardAzc ?? 0), 0n);
  const txs = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.type, "referral_contest_reward"));
  const forContest = txs.filter((row) => row.referenceId === created.id);
  assert.equal(forContest.length, 4);
  assert.equal(
    forContest.reduce((acc, row) => acc + asBigInt(row.amountMinor), 0n),
    134_000n,
  );
  const inbox = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.type, "referral_contest_reward"));
  assert.equal(
    inbox.filter((row) => (row.payload as { contestId?: string }).contestId === created.id)
      .length,
    4,
  );
});

test("exactly five active referrals is eligible for the place prize", async () => {
  const created = await startContest(new Date("2026-04-10T00:00:00.000Z"));
  const p1 = await provisionUser(harness.db);
  await activateMany(p1.referralCode, 5, new Date("2026-04-10T01:00:00.000Z"));
  invalidateReferralContestCache();
  const live = await readReferralContestHomeSummary(harness.db, {
    userId: p1.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-04-10T02:00:00.000Z") },
  });
  assert.equal(live.me.rank, 1);
  assert.equal(live.me.referralCount, 5);
  assert.equal(live.me.potentialRewardAzc, "50000");
  const paid = await finalizeReferralContest(harness.db, created.id, {
    now: new Date("2026-04-11T00:00:00.000Z"),
  });
  assert.equal(paid.winnerCount, 1);
  const txs = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.type, "referral_contest_reward"));
  const forContest = txs.filter((row) => row.referenceId === created.id);
  assert.equal(forContest.length, 1);
  assert.equal(asBigInt(forContest[0]!.amountMinor), 50_000n);
});

test("fewer than five participants pays only existing places", async () => {
  const created = await startContest(new Date("2026-07-01T00:00:00.000Z"));
  const p1 = await provisionUser(harness.db);
  const p2 = await provisionUser(harness.db);
  const r1 = await provisionUser(harness.db);
  const r2 = await provisionUser(harness.db);
  await activateFor(p1.referralCode, r1.userId, new Date("2026-07-01T01:00:00.000Z"));
  await activateFor(p2.referralCode, r2.userId, new Date("2026-07-01T02:00:00.000Z"));
  const paid = await finalizeReferralContest(harness.db, created.id, {
    now: new Date("2026-07-02T00:00:00.000Z"),
  });
  assert.equal(paid.winnerCount, 0);
  const results = await harness.db
    .select()
    .from(referralContestResults)
    .where(eq(referralContestResults.contestId, created.id));
  assert.equal(results.length, 2);
  assert.equal(results.every((row) => asBigInt(row.rewardAzc) === 0n), true);
});

test("blocked referrer is excluded from contest ranking", async () => {
  await startContest(new Date("2026-06-01T00:00:00.000Z"));
  const blocked = await provisionUser(harness.db);
  const ref = await provisionUser(harness.db);
  await activateFor(
    blocked.referralCode,
    ref.userId,
    new Date("2026-06-01T01:00:00.000Z"),
  );
  await harness.db
    .update(users)
    .set({ status: "blocked" })
    .where(eq(users.id, blocked.userId));
  invalidateReferralContestCache();
  const page = await readReferralContestHomeSummary(harness.db, {
    userId: blocked.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-06-01T02:00:00.000Z") },
  });
  assert.ok(page.contest);
  assert.equal(page.leaderboard.length, 0);
  assert.equal(page.me.referralCount, 0);
});
