import {
  manualReferralCredits,
  referralCaseEntitlements,
  referrals,
  users,
  walletTransactions,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { InvalidAmountError } from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import {
  REFERRAL_ACTIVATION_REWARD_AZC,
  attributeReferral,
  listReferralLeaderboard,
  listReferralsForUser,
  readReferralMe,
} from "./referral.js";
import {
  findUserByTelegramUsername,
  grantManualReferralCredit,
  inspectReferralCreditState,
  previewManualReferralGrant,
} from "./referral-manual.js";
import { identifyTelegramUser } from "./telegram-identity.js";
import { provisionUser } from "./user.js";
import { reconcileWallet } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("+25 manual credit updates canonical count, cases, and wallet once", async () => {
  const identified = await identifyTelegramUser(harness.db, {
    telegramUserId: 9_001_001n,
    username: "alldepww_test",
  });
  const usersBefore = await harness.db.select({ id: users.id }).from(users);
  const referralsBefore = await harness.db
    .select({ id: referrals.id })
    .from(referrals)
    .where(eq(referrals.referrerUserId, identified.userId));

  const user = await findUserByTelegramUsername(harness.db, "alldepww_test");
  const before = await inspectReferralCreditState(harness.db, user);
  assert.equal(before.realActivatedReferrals, 0);
  assert.equal(before.existingManualCredits, 0);
  assert.equal(before.canonicalActive, 0);

  const preview = previewManualReferralGrant(before, 25);
  assert.equal(preview.canonicalAfter, 25);
  assert.equal(preview.newCaseMilestones, 5);
  assert.equal(
    preview.totalAzcReward,
    (25n * REFERRAL_ACTIVATION_REWARD_AZC).toString(),
  );

  const granted = await grantManualReferralCredit(harness.db, {
    userId: identified.userId,
    amount: 25,
    idempotencyKey: "manual-referral:alldepww_test:+25",
    metadata: { username: "alldepww_test" },
  });
  assert.equal(granted.replayed, false);
  assert.equal(granted.canonicalActive, 25);
  assert.equal(granted.casesEarned, 5);
  assert.equal(granted.walletBalanceAzc, (25n * REFERRAL_ACTIVATION_REWARD_AZC).toString());

  const me = await readReferralMe(harness.db, {
    userId: identified.userId,
    botUsername: "giftbot_local",
  });
  assert.equal(me.stats.active, 25);
  assert.equal(me.stats.invited, 0);
  assert.equal(me.stats.earnedAzc, (25n * REFERRAL_ACTIVATION_REWARD_AZC).toString());
  assert.equal(me.caseProgress.totalCasesEarned, 5);
  assert.equal(me.caseProgress.availableCases, 5);
  assert.equal(me.caseProgress.current, 0);

  const listed = await listReferralsForUser(harness.db, {
    userId: identified.userId,
  });
  assert.equal(listed.items.length, 0);

  const usersAfter = await harness.db.select({ id: users.id }).from(users);
  const referralsAfter = await harness.db
    .select({ id: referrals.id })
    .from(referrals)
    .where(eq(referrals.referrerUserId, identified.userId));
  assert.equal(usersAfter.length, usersBefore.length);
  assert.equal(referralsAfter.length, referralsBefore.length);

  const board = await listReferralLeaderboard(harness.db, {
    userId: identified.userId,
  });
  assert.equal(board.self?.activeReferrals, 0);
  assert.equal(
    board.items.some((row) => row.userId === identified.userId),
    false,
  );

  const replay = await grantManualReferralCredit(harness.db, {
    userId: identified.userId,
    amount: 25,
    idempotencyKey: "manual-referral:alldepww_test:+25",
    metadata: { username: "alldepww_test" },
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.creditId, granted.creditId);
  assert.equal(replay.walletBalanceAzc, granted.walletBalanceAzc);

  const credits = await harness.db
    .select()
    .from(manualReferralCredits)
    .where(eq(manualReferralCredits.userId, identified.userId));
  assert.equal(credits.length, 1);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, identified.userId));
  assert.equal(
    ledger.filter((row) => row.type === "referral_manual_credit").length,
    1,
  );

  const reconciled = await reconcileWallet(harness.db, identified.userId);
  assert.equal(reconciled.consistent, true);

  await assert.rejects(
    () =>
      grantManualReferralCredit(harness.db, {
        userId: identified.userId,
        amount: 0,
        idempotencyKey: "manual-referral:zero",
      }),
    InvalidAmountError,
  );
  await assert.rejects(
    () =>
      grantManualReferralCredit(harness.db, {
        userId: identified.userId,
        amount: -1,
        idempotencyKey: "manual-referral:neg",
      }),
    InvalidAmountError,
  );
});

test("manual credits stack with real activations for cases but not contest", async () => {
  const referrer = await provisionUser(harness.db);
  const referee = await provisionUser(harness.db);
  await attributeReferral(harness.db, {
    refereeUserId: referee.userId,
    code: referrer.referralCode,
  });
  const { linkKickAccount } = await import("./kick.js");
  await linkKickAccount(harness.db, {
    userId: referee.userId,
    kickUserId: `kick-manual-${referee.userId}`,
  });
  const { onKickAccountLinked } = await import("./referral.js");
  await onKickAccountLinked(harness.db, referee.userId);

  await grantManualReferralCredit(harness.db, {
    userId: referrer.userId,
    amount: 4,
    idempotencyKey: `manual-referral:${referrer.userId}:+4`,
  });
  const me = await readReferralMe(harness.db, {
    userId: referrer.userId,
    botUsername: "giftbot_local",
  });
  assert.equal(me.stats.active, 5);
  assert.equal(me.stats.invited, 1);
  assert.equal(me.caseProgress.totalCasesEarned, 1);
  const listed = await listReferralsForUser(harness.db, {
    userId: referrer.userId,
  });
  assert.equal(listed.items.length, 1);
  const board = await listReferralLeaderboard(harness.db, {
    userId: referrer.userId,
  });
  assert.equal(board.self?.activeReferrals, 1);
});

test("+25 on top of existing consumed V1-style cases grants 5 more entitlements", async () => {
  const identified = await identifyTelegramUser(harness.db, {
    telegramUserId: 9_001_002n,
    username: "alldepww_cutover",
  });
  const consumedAt = new Date();
  for (let n = 1; n <= 5; n += 1) {
    await harness.db.insert(referralCaseEntitlements).values({
      userId: identified.userId,
      milestoneNumber: n,
      referralCountThreshold: n * 5,
      consumedAt,
    });
  }
  const granted = await grantManualReferralCredit(harness.db, {
    userId: identified.userId,
    amount: 25,
    idempotencyKey: "manual-referral:alldepww_cutover:2026-09-20:+25",
  });
  assert.equal(granted.walletBalanceAzc, (25n * REFERRAL_ACTIVATION_REWARD_AZC).toString());
  assert.equal(granted.casesEarned, 10);
  const me = await readReferralMe(harness.db, {
    userId: identified.userId,
    botUsername: "giftbot_local",
  });
  assert.equal(me.caseProgress.availableCases, 5);
  assert.equal(me.stats.active, 25);
});
