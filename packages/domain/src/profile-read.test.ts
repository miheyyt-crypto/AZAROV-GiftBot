import {
  gramBalances,
  inventoryItems,
  notifications,
  products,
  purchases,
  userProgress,
  welvuraLinks,
} from "@giftbot/db/schema";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import {
  decodeProfileCursor,
  readProfileInventory,
  readProfileLedger,
  readProfileNotifications,
  readProfileOrders,
  readProfileSummary,
} from "./profile-read.js";
import { provisionUser } from "./user.js";
import { apply } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("profile summary defaults are zero and unlinked", async () => {
  const user = await provisionUser(harness.db, { displayName: "Reader" });
  const summary = await readProfileSummary(harness.db, user.userId);
  assert.equal(summary.user.displayName, "Reader");
  assert.equal(summary.balances.azc, "0");
  assert.equal(summary.balances.gram, "0");
  assert.equal(summary.gram.available, "0");
  assert.equal(summary.gram.reserved, "0");
  assert.equal(summary.gram.balance, "0");
  assert.equal(summary.gram.minimumWithdrawal, "20");
  assert.equal(summary.gram.canWithdraw, false);
  assert.equal(summary.level.current, 1);
  assert.equal(summary.level.totalXp, "0");
  assert.equal(summary.activity.kickChatMessages, "0");
  assert.equal(summary.integrations.kick.linked, false);
  assert.equal(summary.integrations.welvura.status, "not_linked");
  assert.equal(summary.notifications.unreadCount, 0);
  assert.equal(summary.inventory.itemCount, 0);
  assert.equal(summary.inventory.streakFreezeCount, 0);
  assert.equal(summary.user.avatarUrl, null);
  assert.equal(summary.integrations.kick.avatarUrl, null);
});

test("profile summary reads XP, Gram and Welvura without writing", async () => {
  const user = await provisionUser(harness.db);
  await harness.db.insert(userProgress).values({ userId: user.userId, totalXp: 200n });
  await harness.db.insert(gramBalances).values({ userId: user.userId, amountMinor: 16_000_000n });
  await harness.db.insert(welvuraLinks).values({
    userId: user.userId,
    status: "pending",
    welvuraExternalId: "wv-1",
  });
  const summary = await readProfileSummary(harness.db, user.userId);
  assert.equal(summary.level.current, 2);
  assert.equal(summary.balances.gram, "0.016");
  assert.equal(summary.gram.available, "0.016");
  assert.equal(summary.gram.balance, "0.016");
  assert.equal(summary.gram.canWithdraw, false);
  assert.equal(summary.integrations.welvura.status, "pending");
  assert.equal(summary.integrations.welvura.id, "wv-1");
});

test("empty notifications and inventory lists", async () => {
  const user = await provisionUser(harness.db);
  const notes = await readProfileNotifications(harness.db, { userId: user.userId });
  const items = await readProfileInventory(harness.db, { userId: user.userId });
  const orders = await readProfileOrders(harness.db, { userId: user.userId });
  assert.deepEqual(notes.items, []);
  assert.equal(notes.nextCursor, null);
  assert.deepEqual(items.items, []);
  assert.deepEqual(orders.items, []);
});

test("admin_adjustment and deposit ledger labels are friendly Russian", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "deposit",
    amountMinor: 500n,
    idempotencyKey: `dep-label:${user.userId}`,
    actorType: "system",
  });
  await apply(harness.db, {
    userId: user.userId,
    type: "admin_adjustment",
    amountMinor: 50n,
    idempotencyKey: `adj-label:${user.userId}`,
    actorType: "admin",
    reason: "qa",
  });
  const page = await readProfileLedger(harness.db, { userId: user.userId, limit: 10 });
  const labels = page.items.map((row) => row.label);
  assert.ok(labels.includes("Пополнение"));
  assert.ok(labels.includes("Корректировка баланса"));
  assert.equal(labels.some((label) => label === "admin_adjustment"), false);
  assert.equal(labels.some((label) => label === "deposit"), false);
});

test("ledger history is newest first and paginates", async () => {
  const user = await provisionUser(harness.db);
  await apply(harness.db, {
    userId: user.userId,
    type: "referral_reward",
    amountMinor: 1000n,
    idempotencyKey: `ref:${user.userId}`,
    actorType: "system",
  });
  await apply(harness.db, {
    userId: user.userId,
    type: "purchase",
    amountMinor: -400n,
    idempotencyKey: `buy:${user.userId}`,
    actorType: "user",
    actorId: user.userId,
  });
  const first = await readProfileLedger(harness.db, { userId: user.userId, limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0]?.label, "Покупка в магазине");
  assert.equal(first.items[0]?.delta, "-400");
  assert.ok(first.nextCursor);
  const cursor = decodeProfileCursor(first.nextCursor ?? undefined);
  const second = await readProfileLedger(harness.db, {
    userId: user.userId,
    limit: 1,
    ...(cursor ? { cursor } : {}),
  });
  assert.equal(second.items[0]?.label, "Реферальная награда");
  assert.equal(second.nextCursor, null);
});

test("inventory and orders read only the current user", async () => {
  const owner = await provisionUser(harness.db);
  const other = await provisionUser(harness.db);
  await harness.db.insert(inventoryItems).values({
    userId: owner.userId,
    itemType: "cash_rub",
    amountRub: 200n,
    source: "case",
    status: "available",
  });
  await harness.db.insert(inventoryItems).values({
    userId: owner.userId,
    itemType: "streak_freeze",
    quantity: 2,
    status: "available",
  });
  await harness.db.insert(inventoryItems).values({
    userId: other.userId,
    itemType: "streak_freeze",
    quantity: 9,
    status: "available",
  });
  const [product] = await harness.db
    .insert(products)
    .values({ slug: `welvura-${owner.userId.slice(0, 8)}`, type: "welvura", status: "active" })
    .returning();
  assert.ok(product);
  await harness.db.insert(purchases).values({
    userId: owner.userId,
    productId: product.id,
    status: "created",
    priceMinor: 5555n,
    idempotencyKey: `order:${owner.userId}`,
    submittedPayload: { welvuraId: "abc", slotName: "Sweet Bonanza", token: "secret" },
  });

  const summary = await readProfileSummary(harness.db, owner.userId);
  assert.equal(summary.inventory.itemCount, 3);
  assert.equal(summary.inventory.streakFreezeCount, 2);
  const inventory = await readProfileInventory(harness.db, { userId: owner.userId });
  assert.equal(inventory.items.length, 2);
  const orders = await readProfileOrders(harness.db, { userId: owner.userId });
  assert.equal(orders.items.length, 1);
  assert.equal(orders.items[0]?.status, "pending");
  assert.equal(orders.items[0]?.submittedPreview.welvuraId, "abc");
  assert.equal(orders.items[0]?.submittedPreview.slotName, "Sweet Bonanza");
  assert.ok(!("token" in (orders.items[0]?.submittedPreview ?? {})));
  const otherOrders = await readProfileOrders(harness.db, { userId: other.userId });
  assert.equal(otherOrders.items.length, 0);
});

test("inbox notifications are newest first", async () => {
  const user = await provisionUser(harness.db);
  await harness.db.insert(notifications).values([
    {
      userId: user.userId,
      channel: "inbox" as const,
      type: "streak",
      title: "Стрик",
      body: "saved",
      status: "sent" as const,
    },
    {
      userId: user.userId,
      channel: "telegram" as const,
      type: "hidden",
      title: "nope",
      body: "fanout",
      status: "pending" as const,
    },
  ]);
  const listed = await readProfileNotifications(harness.db, { userId: user.userId });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.title, "Стрик");
  const summary = await readProfileSummary(harness.db, user.userId);
  assert.equal(summary.notifications.unreadCount, 1);
});
