import {
  jobs,
  notifications,
  referralContestResults,
  referrals,
  telegramAccounts,
  users,
  walletTransactions,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ConflictError, InvalidAmountError } from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { linkKickAccount } from "./kick.js";
import {
  REFERRAL_CONTEST_DEFAULT_PRIZES,
  REFERRAL_CONTEST_FIRST_PLACE_MAX_AZC,
  REFERRAL_CONTEST_LEADERBOARD_LIMIT,
  REFERRAL_CONTEST_PRIZE_PLACES,
  REFERRAL_CONTEST_PRIZE_POOL_AZC,
  createReferralContest,
  finalizeReferralContest,
  findOpenReferralContest,
  invalidateReferralContestCache,
  parsePrizeDistribution,
  readReferralContestHomeSummary,
  readReferralContestPage,
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

async function adminUser() {
  return provisionUser(harness.db, { displayName: "admin" });
}

async function startContest(adminId: string, startAt?: Date) {
  invalidateReferralContestCache();
  const open = await findOpenReferralContest(harness.db);
  if (open) {
    await finalizeReferralContest(harness.db, open.id, {
      now: new Date(open.endAt.getTime() + 1000),
      closeWindow: true,
    });
  }
  invalidateReferralContestCache();
  return createReferralContest(harness.db, {
    adminUserId: adminId,
    prizes: TEST_PRIZES,
    startNow: !startAt,
    ...(startAt ? { startAt } : {}),
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

test("prize distribution must have ten places summing to 100000", () => {
  const ok = parsePrizeDistribution(TEST_PRIZES);
  assert.equal(ok.length, REFERRAL_CONTEST_PRIZE_PLACES);
  assert.equal(ok[0]?.rewardAzc, REFERRAL_CONTEST_FIRST_PLACE_MAX_AZC);
  assert.equal(
    ok.reduce((sum, row) => sum + row.rewardAzc, 0n),
    REFERRAL_CONTEST_PRIZE_POOL_AZC,
  );
  assert.equal(
    ok.slice(3).reduce((sum, row) => sum + row.rewardAzc, 0n),
    43_000n,
  );
  assert.throws(
    () => parsePrizeDistribution(TEST_PRIZES.slice(0, 5)),
    InvalidAmountError,
  );
  assert.throws(
    () =>
      parsePrizeDistribution(
        TEST_PRIZES.map((row) => {
          if (row.place === 1) {
            return { ...row, rewardAzc: "25001" };
          }
          if (row.place === 2) {
            return { ...row, rewardAzc: "16999" };
          }
          return row;
        }),
      ),
    InvalidAmountError,
  );
});

test("only activated real referrals in the contest window count", async () => {
  const admin = await adminUser();
  const start = new Date("2026-09-01T00:00:00.000Z");
  const created = await startContest(admin.userId, start);
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
  const page = await readReferralContestPage(harness.db, {
    userId: a.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-09-01T18:00:00.000Z") },
  });
  assert.ok(page.contest);
  assert.equal(page.contest.id, created.id);
  const meA = page.me;
  assert.equal(meA.referralCount, 1);
  const pageB = await readReferralContestPage(harness.db, {
    userId: b.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-09-01T18:00:00.000Z") },
  });
  assert.ok("me" in pageB);
  assert.equal(pageB.me.referralCount, 0);
  const friends = await readReferralMe(harness.db, {
    userId: b.userId,
    botUsername: "giftbot",
  });
  assert.ok(friends.stats.active >= 25);
  const real = await countActivatedReferrals(harness.db, b.userId);
  assert.equal(real, 0);
});

test("deterministic tie-break uses earlier score_reached_at then user id", async () => {
  const admin = await adminUser();
  await startContest(admin.userId, new Date("2026-09-02T00:00:00.000Z"));
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
  const page = await readReferralContestPage(harness.db, {
    userId: early.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-09-02T03:00:00.000Z") },
  });
  assert.ok(page.contest);
  assert.equal(page.leaderboard[0]?.isYou, true);
  assert.equal(page.leaderboard[0]?.referralCount, 1);
  assert.equal(page.me.rank, 1);
  const latePage = await readReferralContestPage(harness.db, {
    userId: late.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-09-02T03:00:00.000Z") },
  });
  assert.ok("me" in latePage);
  assert.equal(latePage.me.rank, 2);
  assert.equal(latePage.me.nextRankGap, 1);
});

test("home summary is cheap and omits leaderboard", async () => {
  const admin = await adminUser();
  const created = await startContest(admin.userId);
  invalidateReferralContestCache();
  const summary = await readReferralContestHomeSummary(harness.db);
  assert.ok(summary);
  assert.equal(summary.id, created.id);
  assert.equal(summary.prizePoolAzc, "100000");
  assert.equal(summary.prizePlaces, 10);
  assert.equal("leaderboard" in summary, false);
});

test("one open contest only", async () => {
  const admin = await adminUser();
  await startContest(admin.userId);
  await assert.rejects(
    () =>
      createReferralContest(harness.db, {
        adminUserId: admin.userId,
        prizes: TEST_PRIZES,
        startNow: true,
      }),
    (error: unknown) =>
      error instanceof ConflictError && error.code === "CONTEST_ALREADY_ACTIVE",
  );
});

test("finalization pays ten winners once and freezes later referrals", async () => {
  const admin = await adminUser();
  const start = new Date("2026-08-01T00:00:00.000Z");
  const created = await startContest(admin.userId, start);
  const p0 = await provisionUser(harness.db, { displayName: "p0" });
  await harness.db.insert(telegramAccounts).values({
    userId: p0.userId,
    telegramUserId: BigInt(910000111),
    firstName: "winner",
    username: "winner0",
  });
  const players = [p0];
  for (let i = 1; i < 11; i += 1) {
    players.push(await provisionUser(harness.db, { displayName: `p${i}` }));
  }
  for (let i = 0; i < players.length; i += 1) {
    const player = players[i]!;
    for (let n = 0; n < players.length - i; n += 1) {
      const ref = await provisionUser(harness.db);
      await activateFor(
        player.referralCode,
        ref.userId,
        new Date(`2026-08-01T${String(n).padStart(2, "0")}:00:00.000Z`),
      );
    }
  }

  invalidateReferralContestCache();
  const live = await readReferralContestPage(harness.db, {
    userId: players[0]!.userId,
    referralUrl: "https://t.me/AZAROV_GiftBot?start=x",
    clock: { now: () => new Date("2026-08-01T12:00:00.000Z") },
  });
  assert.ok(live.contest);
  assert.ok(live.leaderboard.length <= REFERRAL_CONTEST_LEADERBOARD_LIMIT);
  assert.equal(live.contest.prizePlaces, 10);
  assert.equal(live.contest.prizes.length, 10);
  assert.equal(live.me.prizePlace, 1);
  assert.equal(live.me.potentialRewardAzc, "25000");
  assert.equal(live.leaderboard[9]?.rewardAzc, "3000");

  const first = await finalizeReferralContest(harness.db, created.id, {
    now: new Date("2026-08-02T00:00:00.000Z"),
  });
  assert.equal(first.replayed, false);
  assert.equal(first.winnerCount, 10);

  const replay = await finalizeReferralContest(harness.db, created.id, {
    now: new Date("2026-08-02T01:00:00.000Z"),
  });
  assert.equal(replay.replayed, true);

  const extra = await provisionUser(harness.db);
  await activateFor(
    players[9]!.referralCode,
    extra.userId,
    new Date("2026-08-03T00:00:00.000Z"),
  );
  const frozenRows = await harness.db
    .select()
    .from(referralContestResults)
    .where(eq(referralContestResults.contestId, created.id));
  assert.equal(frozenRows.length, 11);
  const tenth = frozenRows.find((row) => row.userId === players[9]!.userId);
  const eleventh = frozenRows.find((row) => row.userId === players[10]!.userId);
  assert.equal(tenth?.place, 10);
  assert.equal(tenth?.referralCount, 2);
  assert.equal(asBigInt(tenth?.rewardAzc ?? 0), 3000n);
  assert.equal(eleventh?.place, 11);
  assert.equal(eleventh?.referralCount, 1);
  assert.equal(asBigInt(eleventh?.rewardAzc ?? 0), 0n);

  const txs = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.type, "referral_contest_reward"));
  const forContest = txs.filter(
    (row) => row.referenceId === created.id,
  );
  assert.equal(forContest.length, 10);
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
  assert.equal(inboxFor.length, 10);

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

test("fewer than ten participants pays only existing places", async () => {
  const admin = await adminUser();
  const created = await startContest(admin.userId, new Date("2026-07-01T00:00:00.000Z"));
  const p1 = await provisionUser(harness.db);
  const p2 = await provisionUser(harness.db);
  const r1 = await provisionUser(harness.db);
  const r2 = await provisionUser(harness.db);
  await activateFor(p1.referralCode, r1.userId, new Date("2026-07-01T01:00:00.000Z"));
  await activateFor(p2.referralCode, r2.userId, new Date("2026-07-01T02:00:00.000Z"));
  const paid = await finalizeReferralContest(harness.db, created.id, {
    now: new Date("2026-07-02T00:00:00.000Z"),
  });
  assert.equal(paid.winnerCount, 2);
  const results = await harness.db
    .select()
    .from(referralContestResults)
    .where(eq(referralContestResults.contestId, created.id));
  assert.equal(results.length, 2);
});

test("blocked referrer is excluded from contest ranking", async () => {
  const admin = await adminUser();
  await startContest(admin.userId, new Date("2026-06-01T00:00:00.000Z"));
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
  const page = await readReferralContestPage(harness.db, {
    userId: blocked.userId,
    referralUrl: null,
    clock: { now: () => new Date("2026-06-01T02:00:00.000Z") },
  });
  assert.ok(page.contest);
  assert.equal(page.leaderboard.length, 0);
  assert.equal(page.me.referralCount, 0);
});
