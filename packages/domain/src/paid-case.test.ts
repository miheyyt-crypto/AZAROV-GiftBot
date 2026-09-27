import {
  inventoryItems,
  notifications,
  paidCaseOpenings,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { and, eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";
import {
  PAID_CASE_CATALOG,
  PAID_CASE_TOTAL_WEIGHT,
  assertPaidCaseCatalogIntegrity,
  listPaidCaseCatalog,
  openPaidCase,
  paidCaseCatalogTotalWeight,
} from "./paid-case.js";
import {
  CaseInsufficientBalanceError,
  PaidCaseOpenFailedError,
} from "./errors.js";
import { provisionUser } from "./user.js";
import { apply } from "./wallet.js";
import { createCashItemWithdrawal } from "./cash-withdrawal.js";

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
    type: "admin_adjustment",
    amountMinor: amount,
    idempotencyKey: key,
    actorType: "admin",
    reason: "paid case test funding",
  });
}

test("paid case catalogs have exact prices, odds, and integer weight totals", () => {
  assertPaidCaseCatalogIntegrity();
  const byCode = Object.fromEntries(
    PAID_CASE_CATALOG.map((row) => [row.code, row]),
  );
  assert.equal(byCode.poor?.priceAzc, 8_999n);
  assert.equal(byCode.medium?.priceAzc, 22_222n);
  assert.equal(byCode.blatnoy?.priceAzc, 64_999n);

  for (const paidCase of PAID_CASE_CATALOG) {
    assert.equal(
      paidCaseCatalogTotalWeight(paidCase.items),
      PAID_CASE_TOTAL_WEIGHT,
    );
    for (const item of paidCase.items) {
      assert.equal(item.displayChance, null);
    }
  }

  const poor = byCode.poor!;
  assert.deepEqual(
    poor.items.map((i) => [i.itemCode, i.realChance, i.weight.toString()]),
    [
      ["poor-cash-5000", "0.001", "1000"],
      ["poor-cash-1000", "0.001", "1000"],
      ["poor-azc-12000", "7", "7000000"],
      ["poor-azc-7777", "10", "10000000"],
      ["poor-azc-5000", "20", "20000000"],
      ["poor-azc-3333", "62.998", "62998000"],
    ],
  );

  const medium = byCode.medium!;
  assert.deepEqual(
    medium.items.map((i) => [i.itemCode, i.realChance, i.weight.toString()]),
    [
      ["medium-cash-10000", "0.001", "1000"],
      ["medium-cash-5000", "0.001", "1000"],
      ["medium-cash-1000", "0.1", "100000"],
      ["medium-azc-20000", "11", "11000000"],
      ["medium-azc-11111", "28", "28000000"],
      ["medium-azc-8888", "60.898", "60898000"],
    ],
  );

  const blatnoy = byCode.blatnoy!;
  assert.deepEqual(
    blatnoy.items.map((i) => [i.itemCode, i.realChance, i.weight.toString()]),
    [
      ["blatnoy-cash-30000", "0.001", "1000"],
      ["blatnoy-cash-10000", "0.001", "1000"],
      ["blatnoy-cash-5000", "1", "1000000"],
      ["blatnoy-cash-2000", "1", "1000000"],
      ["blatnoy-azc-44444", "35", "35000000"],
      ["blatnoy-azc-22222", "62.998", "62998000"],
    ],
  );

  const publicCatalog = listPaidCaseCatalog();
  assert.equal(publicCatalog.length, 3);
  assert.ok(publicCatalog.every((c) => c.items.every((i) => i.displayChance === null)));
  assert.deepEqual(
    publicCatalog
      .find((row) => row.code === "poor")
      ?.items.map((item) => [item.itemCode, item.realChance]),
    [
      ["poor-cash-5000", "0.001"],
      ["poor-cash-1000", "0.001"],
      ["poor-azc-12000", "7"],
      ["poor-azc-7777", "10"],
      ["poor-azc-5000", "20"],
      ["poor-azc-3333", "62.998"],
    ],
  );
});

test("AZC reward keeps separate purchase debit and reward credit", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 20_000n, `fund:${user.userId}:azc`);
  const opened = await openPaidCase(harness.db, {
    userId: user.userId,
    caseCode: "poor",
    idempotencyKey: `poor:${user.userId}:azc`,
    forceItemCodeForTests: "poor-azc-3333",
  });
  assert.equal(opened.result.rewardType, "azc");
  assert.equal(opened.result.rewardAmount, "3333");
  assert.equal(opened.balances.azc, "14334"); // 20000 - 8999 + 3333

  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  const purchase = ledger.filter((row) => row.type === "paid_case_purchase");
  const reward = ledger.filter((row) => row.type === "paid_case_reward");
  assert.equal(purchase.length, 1);
  assert.equal(reward.length, 1);
  assert.equal(asBigInt(purchase[0]!.amountMinor), -8_999n);
  assert.equal(asBigInt(reward[0]!.amountMinor), 3_333n);

  const wallet = await harness.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.userId))
    .limit(1);
  const sum = ledger.reduce((acc, row) => acc + asBigInt(row.amountMinor), 0n);
  assert.equal(asBigInt(wallet[0]!.balanceMinor), sum);
});

test("cash_rub reward creates inventory without Wallet.apply credit", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 10_000n, `fund:${user.userId}:cash`);
  const opened = await openPaidCase(harness.db, {
    userId: user.userId,
    caseCode: "poor",
    idempotencyKey: `poor:${user.userId}:cash`,
    forceItemCodeForTests: "poor-cash-1000",
  });
  assert.equal(opened.result.rewardType, "cash_rub");
  assert.equal(opened.result.rewardAmountRub, "1000");
  assert.ok(opened.result.inventoryItemId);

  const items = await harness.db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, opened.result.inventoryItemId!));
  assert.equal(items[0]?.itemType, "cash_rub");
  assert.equal(items[0]?.status, "available");
  assert.equal(asBigInt(items[0]!.amountRub!), 1_000n);
  assert.equal(items[0]?.source, "poor_case");

  const rewardLedger = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.type, "paid_case_reward"),
      ),
    );
  assert.equal(rewardLedger.length, 0);

  const withdrawal = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: opened.result.inventoryItemId!,
    welvuraId: "PaidCaseCash1",
    idempotencyKey: `cash:${user.userId}:1`,
  });
  assert.equal(withdrawal.withdrawal.status, "pending");
});

test("insufficient balance cannot open", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 100n, `fund:${user.userId}:low`);
  await assert.rejects(
    () =>
      openPaidCase(harness.db, {
        userId: user.userId,
        caseCode: "poor",
        idempotencyKey: `poor:${user.userId}:low`,
        forceItemCodeForTests: "poor-azc-3333",
      }),
    (error: unknown) => error instanceof CaseInsufficientBalanceError,
  );
  const openings = await harness.db
    .select()
    .from(paidCaseOpenings)
    .where(eq(paidCaseOpenings.userId, user.userId));
  assert.equal(openings.length, 0);
});

test("fail after debit rolls back purchase and opening", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 20_000n, `fund:${user.userId}:rollback`);
  await assert.rejects(
    () =>
      openPaidCase(harness.db, {
        userId: user.userId,
        caseCode: "poor",
        idempotencyKey: `poor:${user.userId}:rollback`,
        forceItemCodeForTests: "poor-azc-3333",
        failAfterDebitForTests: true,
      }),
    (error: unknown) => error instanceof PaidCaseOpenFailedError,
  );
  const wallet = await harness.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.userId))
    .limit(1);
  assert.equal(asBigInt(wallet[0]!.balanceMinor), 20_000n);
  const openings = await harness.db
    .select()
    .from(paidCaseOpenings)
    .where(eq(paidCaseOpenings.userId, user.userId));
  assert.equal(openings.length, 0);
  const notes = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId));
  assert.equal(notes.filter((n) => n.type === "paid_case_opened").length, 0);
});

test("same idempotency key replays once", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 50_000n, `fund:${user.userId}:idem`);
  const first = await openPaidCase(harness.db, {
    userId: user.userId,
    caseCode: "medium",
    idempotencyKey: `medium:${user.userId}:same`,
    forceItemCodeForTests: "medium-azc-8888",
  });
  const second = await openPaidCase(harness.db, {
    userId: user.userId,
    caseCode: "medium",
    idempotencyKey: `medium:${user.userId}:same`,
    forceItemCodeForTests: "medium-azc-8888",
  });
  assert.equal(second.replayed, true);
  assert.equal(second.openingId, first.openingId);
  assert.equal(second.result.itemCode, first.result.itemCode);
  const purchases = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.type, "paid_case_purchase"),
      ),
    );
  assert.equal(purchases.length, 1);
});

test("concurrent opens with balance for one yield one success", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 8_999n, `fund:${user.userId}:race1`);
  const results = await Promise.allSettled([
    openPaidCase(harness.db, {
      userId: user.userId,
      caseCode: "poor",
      idempotencyKey: `poor:${user.userId}:race-a`,
      forceItemCodeForTests: "poor-azc-3333",
    }),
    openPaidCase(harness.db, {
      userId: user.userId,
      caseCode: "poor",
      idempotencyKey: `poor:${user.userId}:race-b`,
      forceItemCodeForTests: "poor-azc-3333",
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  const fail = results.filter((row) => row.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(fail.length, 1);
  assert.ok(
    fail[0]!.status === "rejected" &&
      fail[0]!.reason instanceof CaseInsufficientBalanceError,
  );
  const wallet = await harness.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.userId))
    .limit(1);
  assert.ok(asBigInt(wallet[0]!.balanceMinor) >= 0n);
});

test("concurrent opens with enough balance both succeed", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 30_000n, `fund:${user.userId}:race2`);
  const [a, b] = await Promise.all([
    openPaidCase(harness.db, {
      userId: user.userId,
      caseCode: "poor",
      idempotencyKey: `poor:${user.userId}:both-a`,
      forceItemCodeForTests: "poor-azc-3333",
    }),
    openPaidCase(harness.db, {
      userId: user.userId,
      caseCode: "poor",
      idempotencyKey: `poor:${user.userId}:both-b`,
      forceItemCodeForTests: "poor-azc-5000",
    }),
  ]);
  assert.notEqual(a.openingId, b.openingId);
  const purchases = await harness.db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, user.userId),
        eq(walletTransactions.type, "paid_case_purchase"),
      ),
    );
  assert.equal(purchases.length, 2);
});

test("concurrent same key yields one logical opening", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 20_000n, `fund:${user.userId}:samekey`);
  const key = `poor:${user.userId}:same-concurrent`;
  const [a, b] = await Promise.all([
    openPaidCase(harness.db, {
      userId: user.userId,
      caseCode: "poor",
      idempotencyKey: key,
      forceItemCodeForTests: "poor-azc-3333",
    }),
    openPaidCase(harness.db, {
      userId: user.userId,
      caseCode: "poor",
      idempotencyKey: key,
      forceItemCodeForTests: "poor-azc-3333",
    }),
  ]);
  assert.equal(a.openingId, b.openingId);
  const openings = await harness.db
    .select()
    .from(paidCaseOpenings)
    .where(eq(paidCaseOpenings.userId, user.userId));
  assert.equal(openings.length, 1);
});
