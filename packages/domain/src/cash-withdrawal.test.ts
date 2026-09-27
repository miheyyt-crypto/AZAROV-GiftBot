import {
  auditLogs,
  inventoryItems,
  notifications,
  walletTransactions,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  createCashItemWithdrawal,
  fulfillCashItemWithdrawal,
  formatCashRubAmount,
  listUserCashItemWithdrawals,
  markCashItemWithdrawalProcessing,
  parseCashWelvuraId,
  rejectCashItemWithdrawal,
} from "./cash-withdrawal.js";
import {
  CashItemInvalidTypeError,
  CashItemNotAvailableError,
  CashItemNotOwnedError,
  CashRejectionReasonRequiredError,
  CashWithdrawalInvalidWelvuraIdError,
  InvalidTransitionError,
} from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";
import { provisionUser } from "./user.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

async function seedCashItem(
  userId: string,
  amountRub: bigint,
  source = "free_case",
  status: "available" | "reserved" | "consumed" = "available",
) {
  const rows = await harness.db
    .insert(inventoryItems)
    .values({
      userId,
      itemType: "cash_rub",
      status,
      amountRub,
      source,
      quantity: 1,
    })
    .returning();
  const row = rows[0];
  assert.ok(row);
  return row;
}

async function seedFreeze(userId: string) {
  const rows = await harness.db
    .insert(inventoryItems)
    .values({
      userId,
      itemType: "streak_freeze",
      status: "available",
      quantity: 1,
      source: "shop:test",
    })
    .returning();
  const row = rows[0];
  assert.ok(row);
  return row;
}

async function readItem(itemId: string) {
  const rows = await harness.db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .limit(1);
  const row = rows[0];
  assert.ok(row);
  return row;
}

test("welvura id is trimmed and rejects urls", () => {
  assert.equal(parseCashWelvuraId(" WID123 "), "WID123");
  assert.throws(() => parseCashWelvuraId(""), CashWithdrawalInvalidWelvuraIdError);
  assert.throws(() => parseCashWelvuraId("   "), CashWithdrawalInvalidWelvuraIdError);
  assert.throws(
    () => parseCashWelvuraId("https://evil.example/x"),
    CashWithdrawalInvalidWelvuraIdError,
  );
  assert.throws(
    () => parseCashWelvuraId("a<b>"),
    CashWithdrawalInvalidWelvuraIdError,
  );
  assert.equal(formatCashRubAmount(3000n), "3 000 ₽");
});

test("available cash item can create a withdrawal", async () => {
  const user = await provisionUser(harness.db);
  const item = await seedCashItem(user.userId, 3000n, "medium_case");
  const created = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: item.id,
    welvuraId: "welvura_user",
    idempotencyKey: `cash.create:${user.userId}:ok`,
  });
  assert.equal(created.replayed, false);
  assert.equal(created.withdrawal.status, "pending");
  assert.equal(created.withdrawal.amountRub, "3000");
  assert.equal(created.withdrawal.welvuraId, "welvura_user");
  assert.equal(created.withdrawal.source, "medium_case");
  assert.equal((await readItem(item.id)).status, "reserved");
  const inbox = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId));
  assert.equal(inbox.length, 1);
  assert.match(inbox[0]?.body ?? "", /3 000/);
});

test("same idempotency key replays without a second reservation", async () => {
  const user = await provisionUser(harness.db);
  const item = await seedCashItem(user.userId, 1000n);
  const key = `cash.create:${user.userId}:replay`;
  const first = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: item.id,
    welvuraId: "wid1",
    idempotencyKey: key,
  });
  const second = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: item.id,
    welvuraId: "wid1",
    idempotencyKey: key,
  });
  assert.equal(second.replayed, true);
  assert.equal(second.withdrawal.id, first.withdrawal.id);
  const listed = await listUserCashItemWithdrawals(harness.db, {
    userId: user.userId,
  });
  assert.equal(listed.items.length, 1);
});

test("reserved item cannot create a second withdrawal", async () => {
  const user = await provisionUser(harness.db);
  const item = await seedCashItem(user.userId, 5000n);
  await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: item.id,
    welvuraId: "widA",
    idempotencyKey: `cash.create:${user.userId}:first`,
  });
  await assert.rejects(
    () =>
      createCashItemWithdrawal(harness.db, {
        userId: user.userId,
        itemId: item.id,
        welvuraId: "widB",
        idempotencyKey: `cash.create:${user.userId}:second`,
      }),
    CashItemNotAvailableError,
  );
});

test("consumed item cannot withdraw", async () => {
  const user = await provisionUser(harness.db);
  const item = await seedCashItem(user.userId, 1000n, "poor_case", "consumed");
  await assert.rejects(
    () =>
      createCashItemWithdrawal(harness.db, {
        userId: user.userId,
        itemId: item.id,
        welvuraId: "wid",
        idempotencyKey: `cash.create:${user.userId}:consumed`,
      }),
    CashItemNotAvailableError,
  );
});

test("item owned by another user is rejected", async () => {
  const owner = await provisionUser(harness.db);
  const other = await provisionUser(harness.db);
  const item = await seedCashItem(owner.userId, 1000n);
  await assert.rejects(
    () =>
      createCashItemWithdrawal(harness.db, {
        userId: other.userId,
        itemId: item.id,
        welvuraId: "wid",
        idempotencyKey: `cash.create:${other.userId}:steal`,
      }),
    CashItemNotOwnedError,
  );
});

test("wrong inventory type is rejected", async () => {
  const user = await provisionUser(harness.db);
  const freeze = await seedFreeze(user.userId);
  await assert.rejects(
    () =>
      createCashItemWithdrawal(harness.db, {
        userId: user.userId,
        itemId: freeze.id,
        welvuraId: "wid",
        idempotencyKey: `cash.create:${user.userId}:freeze`,
      }),
    CashItemInvalidTypeError,
  );
});

test("fulfill consumes the reserved item without Wallet.apply", async () => {
  const user = await provisionUser(harness.db);
  const admin = await provisionUser(harness.db);
  const item = await seedCashItem(user.userId, 10_000n, "blatnoy_case");
  const created = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: item.id,
    welvuraId: "widF",
    idempotencyKey: `cash.create:${user.userId}:fulfill`,
  });
  const fulfilled = await fulfillCashItemWithdrawal(harness.db, {
    withdrawalId: created.withdrawal.id,
    adminUserId: admin.userId,
    idempotencyKey: `cash.fulfill:${created.withdrawal.id}`,
  });
  assert.equal(fulfilled.withdrawal.status, "fulfilled");
  assert.equal((await readItem(item.id)).status, "consumed");
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.length, 0);
  const audits = await harness.db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, "cash_withdrawal.fulfilled"));
  assert.ok(audits.some((row) => row.targetId === created.withdrawal.id));
});

test("reject restores the same item and amount", async () => {
  const user = await provisionUser(harness.db);
  const admin = await provisionUser(harness.db);
  const item = await seedCashItem(user.userId, 3000n, "referral_case");
  const created = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: item.id,
    welvuraId: "widR",
    idempotencyKey: `cash.create:${user.userId}:reject`,
  });
  await markCashItemWithdrawalProcessing(harness.db, {
    withdrawalId: created.withdrawal.id,
    adminUserId: admin.userId,
    idempotencyKey: `cash.process:${created.withdrawal.id}`,
  });
  const rejected = await rejectCashItemWithdrawal(harness.db, {
    withdrawalId: created.withdrawal.id,
    adminUserId: admin.userId,
    reason: "неверный Welvura ID",
    idempotencyKey: `cash.reject:${created.withdrawal.id}`,
  });
  assert.equal(rejected.withdrawal.status, "rejected");
  assert.equal(rejected.withdrawal.rejectionReason, "неверный Welvura ID");
  const restored = await readItem(item.id);
  assert.equal(restored.status, "available");
  assert.equal(asBigInt(restored.amountRub ?? 0n), 3000n);
  assert.equal(restored.id, item.id);
});

test("terminal withdrawals are immutable and reject requires reason", async () => {
  const user = await provisionUser(harness.db);
  const admin = await provisionUser(harness.db);
  const item = await seedCashItem(user.userId, 1000n);
  const created = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: item.id,
    welvuraId: "widT",
    idempotencyKey: `cash.create:${user.userId}:term`,
  });
  await fulfillCashItemWithdrawal(harness.db, {
    withdrawalId: created.withdrawal.id,
    adminUserId: admin.userId,
    idempotencyKey: `cash.fulfill:${created.withdrawal.id}:a`,
  });
  await assert.rejects(
    () =>
      rejectCashItemWithdrawal(harness.db, {
        withdrawalId: created.withdrawal.id,
        adminUserId: admin.userId,
        reason: "late",
        idempotencyKey: `cash.reject:${created.withdrawal.id}:late`,
      }),
    InvalidTransitionError,
  );
  await assert.rejects(
    () =>
      rejectCashItemWithdrawal(harness.db, {
        withdrawalId: created.withdrawal.id,
        adminUserId: admin.userId,
        reason: "   ",
        idempotencyKey: `cash.reject:${created.withdrawal.id}:empty`,
      }),
    CashRejectionReasonRequiredError,
  );
});

test("amount snapshot matches the inventory item", async () => {
  const user = await provisionUser(harness.db);
  const item = await seedCashItem(user.userId, 5000n);
  const created = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: item.id,
    welvuraId: "snap",
    idempotencyKey: `cash.create:${user.userId}:snap`,
  });
  assert.equal(created.withdrawal.amountRub, "5000");
  assert.equal(
    created.withdrawal.amountRub,
    asBigInt(item.amountRub ?? 0n).toString(),
  );
});

test("concurrent create on same item yields one withdrawal", async () => {
  const user = await provisionUser(harness.db);
  const item = await seedCashItem(user.userId, 2000n);
  const results = await Promise.allSettled([
    createCashItemWithdrawal(harness.db, {
      userId: user.userId,
      itemId: item.id,
      welvuraId: "concA",
      idempotencyKey: `cash.create:${user.userId}:concA`,
    }),
    createCashItemWithdrawal(harness.db, {
      userId: user.userId,
      itemId: item.id,
      welvuraId: "concB",
      idempotencyKey: `cash.create:${user.userId}:concB`,
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  const failed = results.filter((row) => row.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.equal((await readItem(item.id)).status, "reserved");
  const listed = await listUserCashItemWithdrawals(harness.db, {
    userId: user.userId,
  });
  assert.equal(listed.items.length, 1);
});

test("fulfill vs reject race has one terminal outcome", async () => {
  const user = await provisionUser(harness.db);
  const admin = await provisionUser(harness.db);
  const item = await seedCashItem(user.userId, 4000n);
  const created = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: item.id,
    welvuraId: "race",
    idempotencyKey: `cash.create:${user.userId}:race`,
  });
  const results = await Promise.allSettled([
    fulfillCashItemWithdrawal(harness.db, {
      withdrawalId: created.withdrawal.id,
      adminUserId: admin.userId,
      idempotencyKey: `cash.fulfill:${created.withdrawal.id}:race`,
    }),
    rejectCashItemWithdrawal(harness.db, {
      withdrawalId: created.withdrawal.id,
      adminUserId: admin.userId,
      reason: "race reject",
      idempotencyKey: `cash.reject:${created.withdrawal.id}:race`,
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  assert.equal(ok.length, 1);
  const itemAfter = await readItem(item.id);
  assert.ok(
    itemAfter.status === "consumed" || itemAfter.status === "available",
  );
  if (itemAfter.status === "consumed") {
    assert.ok(
      ok[0]?.status === "fulfilled" &&
        ok[0].value.withdrawal.status === "fulfilled",
    );
  } else {
    assert.ok(
      ok[0]?.status === "fulfilled" &&
        ok[0].value.withdrawal.status === "rejected",
    );
  }
});

test("double reject releases once and double fulfill consumes once", async () => {
  const user = await provisionUser(harness.db);
  const admin = await provisionUser(harness.db);
  const rejectItem = await seedCashItem(user.userId, 1500n, "free_case");
  const fulfillItem = await seedCashItem(user.userId, 2500n, "poor_case");
  const forReject = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: rejectItem.id,
    welvuraId: "drej",
    idempotencyKey: `cash.create:${user.userId}:drej`,
  });
  const forFulfill = await createCashItemWithdrawal(harness.db, {
    userId: user.userId,
    itemId: fulfillItem.id,
    welvuraId: "dful",
    idempotencyKey: `cash.create:${user.userId}:dful`,
  });
  const rejectResults = await Promise.all([
    rejectCashItemWithdrawal(harness.db, {
      withdrawalId: forReject.withdrawal.id,
      adminUserId: admin.userId,
      reason: "first",
      idempotencyKey: `cash.reject:${forReject.withdrawal.id}:a`,
    }),
    rejectCashItemWithdrawal(harness.db, {
      withdrawalId: forReject.withdrawal.id,
      adminUserId: admin.userId,
      reason: "second",
      idempotencyKey: `cash.reject:${forReject.withdrawal.id}:b`,
    }),
  ]);
  assert.equal(
    rejectResults.filter((row) => row.replayed).length +
      rejectResults.filter((row) => !row.replayed).length,
    2,
  );
  assert.equal(
    rejectResults.filter((row) => !row.replayed).length,
    1,
  );
  assert.equal((await readItem(rejectItem.id)).status, "available");

  const fulfillResults = await Promise.all([
    fulfillCashItemWithdrawal(harness.db, {
      withdrawalId: forFulfill.withdrawal.id,
      adminUserId: admin.userId,
      idempotencyKey: `cash.fulfill:${forFulfill.withdrawal.id}:a`,
    }),
    fulfillCashItemWithdrawal(harness.db, {
      withdrawalId: forFulfill.withdrawal.id,
      adminUserId: admin.userId,
      idempotencyKey: `cash.fulfill:${forFulfill.withdrawal.id}:b`,
    }),
  ]);
  assert.equal(fulfillResults.filter((row) => !row.replayed).length, 1);
  assert.equal((await readItem(fulfillItem.id)).status, "consumed");
});
