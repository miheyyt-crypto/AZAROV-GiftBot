import {
  notifications,
  promoCodes,
  promoRedemptions,
  walletTransactions,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  PromoAlreadyRedeemedError,
  PromoInactiveError,
  PromoInvalidCodeError,
  PromoLimitReachedError,
  PromoNotFoundError,
} from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";
import {
  createPromoCode,
  deactivatePromoCode,
  normalizePromoCodeInput,
  redeemPromoCode,
} from "./promo.js";
import { provisionUser } from "./user.js";
import { reconcileWallet } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("promo codes normalize ASCII case without locale rules", () => {
  assert.equal(normalizePromoCodeInput("  azarov  "), "AZAROV");
  assert.equal(normalizePromoCodeInput("AZAROV"), "AZAROV");
  assert.equal(normalizePromoCodeInput("Az-Ar_1"), "AZ-AR_1");
  assert.throws(() => normalizePromoCodeInput(""), PromoInvalidCodeError);
  assert.throws(() => normalizePromoCodeInput("   "), PromoInvalidCodeError);
  assert.throws(() => normalizePromoCodeInput("bad code"), PromoInvalidCodeError);
  assert.throws(() => normalizePromoCodeInput("азаров"), PromoInvalidCodeError);
  assert.throws(
    () => normalizePromoCodeInput("x".repeat(65)),
    PromoInvalidCodeError,
  );
});

test("successful redemption credits wallet, ledger, count, and inbox notification", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  const created = await createPromoCode(harness.db, {
    code: "AZAROV",
    rewardAzc: "999",
    activationLimit: 100,
    adminUserId: admin.userId,
    idempotencyKey: `promo.create:${user.userId}:ok`,
  });
  const result = await redeemPromoCode(harness.db, {
    userId: user.userId,
    code: "azarov",
    idempotencyKey: `promo.redeem:${user.userId}:ok`,
  });
  assert.equal(result.status, "redeemed");
  assert.equal(result.rewardAzc, "999");
  assert.equal(result.newBalanceAzc, "999");
  assert.equal(result.replayed, false);

  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.consistent, true);
  assert.equal(report.balanceMinor, 999n);
  assert.equal(report.ledgerSumMinor, 999n);

  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.type, "promo_code_reward");
  assert.equal(asBigInt(ledger[0]?.amountMinor ?? 0n), 999n);

  const promoRows = await harness.db
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.id, created.promo.id));
  assert.equal(promoRows[0]?.activationCount, 1);

  const notes = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId));
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.channel, "inbox");
  assert.equal(notes[0]?.title, "Промокод активирован");
  assert.equal(notes[0]?.body, "Начислено 999 AZC");
  assert.equal(notes[0]?.type, "promo_code_reward");
});

test("same user cannot redeem the same promo twice with a different key", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await createPromoCode(harness.db, {
    code: "ONCEONLY",
    rewardAzc: "10",
    activationLimit: 5,
    adminUserId: admin.userId,
    idempotencyKey: `promo.create:${user.userId}:dup`,
  });
  await redeemPromoCode(harness.db, {
    userId: user.userId,
    code: "ONCEONLY",
    idempotencyKey: `promo.redeem:${user.userId}:dup-a`,
  });
  await assert.rejects(
    () =>
      redeemPromoCode(harness.db, {
        userId: user.userId,
        code: "onceonly",
        idempotencyKey: `promo.redeem:${user.userId}:dup-b`,
      }),
    PromoAlreadyRedeemedError,
  );
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 10n);
  assert.equal(report.consistent, true);
});

test("same idempotency key replays without a second credit", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await createPromoCode(harness.db, {
    code: "REPLAYME",
    rewardAzc: "25",
    activationLimit: 3,
    adminUserId: admin.userId,
    idempotencyKey: `promo.create:${user.userId}:replay`,
  });
  const key = `promo.redeem:${user.userId}:same`;
  const first = await redeemPromoCode(harness.db, {
    userId: user.userId,
    code: "REPLAYME",
    idempotencyKey: key,
  });
  const second = await redeemPromoCode(harness.db, {
    userId: user.userId,
    code: "REPLAYME",
    idempotencyKey: key,
  });
  assert.equal(second.replayed, true);
  assert.equal(second.rewardAzc, first.rewardAzc);
  assert.equal(second.newBalanceAzc, first.newBalanceAzc);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 25n);
  assert.equal((await harness.db.select().from(promoRedemptions)).filter((row) => row.userId === user.userId).length, 1);
});

test("inactive and missing codes are rejected", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  const created = await createPromoCode(harness.db, {
    code: "SLEEPY",
    rewardAzc: "5",
    activationLimit: 2,
    adminUserId: admin.userId,
    idempotencyKey: `promo.create:${user.userId}:inactive`,
  });
  await deactivatePromoCode(harness.db, {
    promoCodeId: created.promo.id,
    adminUserId: admin.userId,
    idempotencyKey: `promo.deactivate:${created.promo.id}`,
  });
  await assert.rejects(
    () =>
      redeemPromoCode(harness.db, {
        userId: user.userId,
        code: "SLEEPY",
        idempotencyKey: `promo.redeem:${user.userId}:inactive`,
      }),
    PromoInactiveError,
  );
  await assert.rejects(
    () =>
      redeemPromoCode(harness.db, {
        userId: user.userId,
        code: "NOSUCHCODE",
        idempotencyKey: `promo.redeem:${user.userId}:missing`,
      }),
    PromoNotFoundError,
  );
});

test("exhausted promo cannot be redeemed", async () => {
  const admin = await provisionUser(harness.db);
  const firstUser = await provisionUser(harness.db);
  const secondUser = await provisionUser(harness.db);
  await createPromoCode(harness.db, {
    code: "ONELEFT",
    rewardAzc: "3",
    activationLimit: 1,
    adminUserId: admin.userId,
    idempotencyKey: `promo.create:${firstUser.userId}:exhausted`,
  });
  await redeemPromoCode(harness.db, {
    userId: firstUser.userId,
    code: "ONELEFT",
    idempotencyKey: `promo.redeem:${firstUser.userId}:exhausted`,
  });
  await assert.rejects(
    () =>
      redeemPromoCode(harness.db, {
        userId: secondUser.userId,
        code: "ONELEFT",
        idempotencyKey: `promo.redeem:${secondUser.userId}:exhausted`,
      }),
    PromoLimitReachedError,
  );
});

test("concurrent last-slot redeems issue exactly one reward", async () => {
  const admin = await provisionUser(harness.db);
  const firstUser = await provisionUser(harness.db);
  const secondUser = await provisionUser(harness.db);
  const created = await createPromoCode(harness.db, {
    code: "LASTSLOT",
    rewardAzc: "77",
    activationLimit: 100,
    adminUserId: admin.userId,
    idempotencyKey: `promo.create:${firstUser.userId}:race`,
  });
  await harness.db
    .update(promoCodes)
    .set({ activationCount: 99 })
    .where(eq(promoCodes.id, created.promo.id));

  const results = await Promise.allSettled([
    redeemPromoCode(harness.db, {
      userId: firstUser.userId,
      code: "LASTSLOT",
      idempotencyKey: `promo.redeem:${firstUser.userId}:race`,
    }),
    redeemPromoCode(harness.db, {
      userId: secondUser.userId,
      code: "LASTSLOT",
      idempotencyKey: `promo.redeem:${secondUser.userId}:race`,
    }),
  ]);

  const fulfilled = results.filter((row) => row.status === "fulfilled");
  const rejected = results.filter((row) => row.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(
    rejected[0] &&
      rejected[0].status === "rejected" &&
      rejected[0].reason instanceof PromoLimitReachedError,
  );

  const promoRows = await harness.db
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.id, created.promo.id));
  assert.equal(promoRows[0]?.activationCount, 100);

  const firstReport = await reconcileWallet(harness.db, firstUser.userId);
  const secondReport = await reconcileWallet(harness.db, secondUser.userId);
  assert.equal(firstReport.consistent, true);
  assert.equal(secondReport.consistent, true);
  assert.equal(firstReport.balanceMinor + secondReport.balanceMinor, 77n);

  const credits = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.type, "promo_code_reward"));
  const raceCredits = credits.filter(
    (row) =>
      row.userId === firstUser.userId || row.userId === secondUser.userId,
  );
  assert.equal(raceCredits.length, 1);
  assert.equal(asBigInt(raceCredits[0]?.amountMinor ?? 0n), 77n);
});
