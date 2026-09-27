import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { after, before, test } from "node:test";
import {
  referralCaseEntitlements,
  referrals,
  walletTransactions,
} from "@giftbot/db/schema";
import { ConflictError, NotFoundError } from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { linkKickAccount } from "./kick.js";
import {
  REFERRAL_ACTIVATION_REWARD_AZC,
  activateReferralIfEligible,
  attributeReferral,
  buildReferralUrl,
  listReferralLeaderboard,
  onKickAccountLinked,
  readReferralMe,
  transitionReferral,
} from "./referral.js";
import {
  REFERRAL_CASE_CATALOG,
  REFERRAL_CASE_TOTAL_WEIGHT,
  assertReferralCaseCatalogIntegrity,
  openReferralCase,
  referralCaseCatalogTotalWeight,
} from "./referral-case.js";
import { asBigInt } from "./money.js";
import { provisionUser } from "./user.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("attribution does not activate a referral", async () => {
  const referrer = await provisionUser(harness.db);
  const referee = await provisionUser(harness.db);
  const attributed = await attributeReferral(harness.db, {
    refereeUserId: referee.userId,
    code: referrer.referralCode,
  });
  assert.equal(attributed.status, "attributed");
  assert.equal(attributed.replayed, false);

  const replay = await attributeReferral(harness.db, {
    refereeUserId: referee.userId,
    code: referrer.referralCode,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.status, "attributed");
});

test("self-referral is rejected", async () => {
  const user = await provisionUser(harness.db);
  await assert.rejects(
    () =>
      attributeReferral(harness.db, {
        refereeUserId: user.userId,
        code: user.referralCode,
      }),
    ConflictError,
  );
});

test("second inviter cannot replace first attribution", async () => {
  const a = await provisionUser(harness.db);
  const b = await provisionUser(harness.db);
  const referee = await provisionUser(harness.db);
  await attributeReferral(harness.db, {
    refereeUserId: referee.userId,
    code: a.referralCode,
  });
  const second = await attributeReferral(harness.db, {
    refereeUserId: referee.userId,
    code: b.referralCode,
  });
  assert.equal(second.replayed, true);
  const rows = await harness.db
    .select()
    .from(referrals)
    .where(eq(referrals.refereeUserId, referee.userId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.referrerUserId, a.userId);
});

test("invalid token does not break and remains not found", async () => {
  const referee = await provisionUser(harness.db);
  await assert.rejects(
    () =>
      attributeReferral(harness.db, {
        refereeUserId: referee.userId,
        code: "missing-token-zzzz",
      }),
    NotFoundError,
  );
});

test("Kick link activates once with exact +1000 each and milestone at 5", async () => {
  const referrer = await provisionUser(harness.db);

  const results = [];
  for (let i = 0; i < 5; i += 1) {
    const referee = await provisionUser(harness.db);
    await attributeReferral(harness.db, {
      refereeUserId: referee.userId,
      code: referrer.referralCode,
    });
    // Telegram-only: no activation yet
    const idle = await activateReferralIfEligible(harness.db, referee.userId);
    assert.equal(idle.activated, false);

    await linkKickAccount(harness.db, {
      userId: referee.userId,
      kickUserId: `kick-${referee.userId}`,
    });
    results.push(await onKickAccountLinked(harness.db, referee.userId));

    // Relink must not pay again
    await linkKickAccount(harness.db, {
      userId: referee.userId,
      kickUserId: `kick-${referee.userId}`,
    });
    const again = await onKickAccountLinked(harness.db, referee.userId);
    assert.equal(again.replayed, true);
    assert.equal(again.activated, false);

    const referredLedger = await harness.db
      .select()
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.userId, referee.userId),
          eq(walletTransactions.type, "referral_referred_reward"),
        ),
      );
    assert.equal(referredLedger.length, 1);
    assert.equal(asBigInt(referredLedger[0]!.amountMinor), REFERRAL_ACTIVATION_REWARD_AZC);
  }

  assert.equal(results.filter((r) => r.activated).length, 5);
  assert.equal(results[4]?.milestoneGranted, true);
  assert.equal(results[4]?.milestoneNumber, 1);

  const inviterLedger = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, referrer.userId),
        eq(walletTransactions.type, "referral_inviter_reward"),
      ),
    );
  assert.equal(inviterLedger.length, 5);

  const entitlements = await harness.db
    .select()
    .from(referralCaseEntitlements)
    .where(eq(referralCaseEntitlements.userId, referrer.userId));
  assert.equal(entitlements.length, 1);
  assert.equal(entitlements[0]?.milestoneNumber, 1);

  const me = await readReferralMe(harness.db, {
    userId: referrer.userId,
    botUsername: "giftbot_local",
  });
  assert.equal(me.stats.invited, 5);
  assert.equal(me.stats.active, 5);
  assert.equal(me.stats.earnedAzc, "5000");
  assert.equal(me.caseProgress.availableCases, 1);
  assert.equal(me.caseProgress.totalCasesEarned, 1);
  assert.equal(me.referralUrl, buildReferralUrl(referrer.referralCode, "giftbot_local"));
});

test("milestones at 5/10 only", async () => {
  const referrer = await provisionUser(harness.db);
  for (let i = 0; i < 10; i += 1) {
    const referee = await provisionUser(harness.db);
    await attributeReferral(harness.db, {
      refereeUserId: referee.userId,
      code: referrer.referralCode,
    });
    await linkKickAccount(harness.db, {
      userId: referee.userId,
      kickUserId: `kick-m-${referee.userId}`,
    });
    await onKickAccountLinked(harness.db, referee.userId);
  }
  const entitlements = await harness.db
    .select()
    .from(referralCaseEntitlements)
    .where(eq(referralCaseEntitlements.userId, referrer.userId));
  assert.equal(entitlements.length, 2);
  assert.deepEqual(
    entitlements.map((e) => e.milestoneNumber).sort((a, b) => a - b),
    [1, 2],
  );
});

test("concurrent Kick activation yields one reward pair", async () => {
  const referrer = await provisionUser(harness.db);
  const referee = await provisionUser(harness.db);
  await attributeReferral(harness.db, {
    refereeUserId: referee.userId,
    code: referrer.referralCode,
  });
  await linkKickAccount(harness.db, {
    userId: referee.userId,
    kickUserId: `kick-c-${referee.userId}`,
  });
  const [a, b] = await Promise.all([
    onKickAccountLinked(harness.db, referee.userId),
    onKickAccountLinked(harness.db, referee.userId),
  ]);
  assert.equal([a, b].filter((r) => r.activated).length, 1);
  assert.equal([a, b].filter((r) => r.replayed || r.activated).length, 2);
  const inviter = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, referrer.userId),
        eq(walletTransactions.type, "referral_inviter_reward"),
      ),
    );
  assert.equal(inviter.length, 1);
});

test("reject transition still works without rewards", async () => {
  const referrer = await provisionUser(harness.db);
  const referee = await provisionUser(harness.db);
  const attributed = await attributeReferral(harness.db, {
    refereeUserId: referee.userId,
    code: referrer.referralCode,
  });
  const rejected = await transitionReferral(harness.db, {
    referralId: attributed.id,
    to: "rejected",
    reason: "fraud",
  });
  assert.equal(rejected.status, "rejected");
});

test("referral case catalog exact odds and null displayChance", () => {
  assertReferralCaseCatalogIntegrity();
  assert.equal(
    referralCaseCatalogTotalWeight(REFERRAL_CASE_CATALOG.items),
    REFERRAL_CASE_TOTAL_WEIGHT,
  );
  const byCode = Object.fromEntries(
    REFERRAL_CASE_CATALOG.items.map((item) => [
      item.itemCode,
      { chance: item.realChance, weight: item.weight.toString(), display: item.displayChance },
    ]),
  );
  assert.deepEqual(byCode["referral-cash-3000"], {
    chance: "0.001",
    weight: "1000",
    display: null,
  });
  assert.deepEqual(byCode["referral-cash-1000"], {
    chance: "0.001",
    weight: "1000",
    display: null,
  });
  assert.deepEqual(byCode["referral-azc-1500"], {
    chance: "8",
    weight: "8000000",
    display: null,
  });
  assert.deepEqual(byCode["referral-azc-6000"], {
    chance: "20",
    weight: "20000000",
    display: null,
  });
  assert.deepEqual(byCode["referral-azc-2500"], {
    chance: "30.998",
    weight: "30998000",
    display: null,
  });
  assert.deepEqual(byCode["referral-azc-1000"], {
    chance: "41",
    weight: "41000000",
    display: null,
  });
});

test("referral case open consumes entitlement and never debits AZC", async () => {
  const referrer = await provisionUser(harness.db);
  for (let i = 0; i < 5; i += 1) {
    const referee = await provisionUser(harness.db);
    await attributeReferral(harness.db, {
      refereeUserId: referee.userId,
      code: referrer.referralCode,
    });
    await linkKickAccount(harness.db, {
      userId: referee.userId,
      kickUserId: `kick-open-${referee.userId}`,
    });
    await onKickAccountLinked(harness.db, referee.userId);
  }

  const opened = await openReferralCase(harness.db, {
    userId: referrer.userId,
    idempotencyKey: `ref-open-${referrer.userId}`,
    forceItemCodeForTests: "referral-azc-1000",
  });
  assert.equal(opened.result.rewardAmount, "1000");
  assert.equal(opened.availableCases, 0);

  const debit = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, referrer.userId),
        eq(walletTransactions.type, "paid_case_purchase"),
      ),
    );
  assert.equal(debit.length, 0);

  const reward = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, referrer.userId),
        eq(walletTransactions.type, "referral_case_reward"),
      ),
    );
  assert.equal(reward.length, 1);

  const replay = await openReferralCase(harness.db, {
    userId: referrer.userId,
    idempotencyKey: `ref-open-${referrer.userId}`,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.openingId, opened.openingId);
});

test("referral case concurrent open with one entitlement", async () => {
  const referrer = await provisionUser(harness.db);
  for (let i = 0; i < 5; i += 1) {
    const referee = await provisionUser(harness.db);
    await attributeReferral(harness.db, {
      refereeUserId: referee.userId,
      code: referrer.referralCode,
    });
    await linkKickAccount(harness.db, {
      userId: referee.userId,
      kickUserId: `kick-conc-${referee.userId}`,
    });
    await onKickAccountLinked(harness.db, referee.userId);
  }

  const results = await Promise.allSettled([
    openReferralCase(harness.db, {
      userId: referrer.userId,
      idempotencyKey: `a-${referrer.userId}`,
      forceItemCodeForTests: "referral-azc-1000",
    }),
    openReferralCase(harness.db, {
      userId: referrer.userId,
      idempotencyKey: `b-${referrer.userId}`,
      forceItemCodeForTests: "referral-azc-1000",
    }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const fail = results.filter((r) => r.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(fail.length, 1);
});

test("referral leaderboard ranks by activated count", async () => {
  const top = await provisionUser(harness.db);
  const low = await provisionUser(harness.db);
  for (let i = 0; i < 2; i += 1) {
    const referee = await provisionUser(harness.db);
    await attributeReferral(harness.db, {
      refereeUserId: referee.userId,
      code: top.referralCode,
    });
    await linkKickAccount(harness.db, {
      userId: referee.userId,
      kickUserId: `kick-lb-${referee.userId}`,
    });
    await onKickAccountLinked(harness.db, referee.userId);
  }
  const board = await listReferralLeaderboard(harness.db, { userId: low.userId });
  assert.ok(board.items.some((row) => row.userId === top.userId));
  assert.ok(board.self);
  assert.equal(board.self?.isYou, true);
});
