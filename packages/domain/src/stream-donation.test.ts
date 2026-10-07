import {
  streamAlertConsumers,
  streamDonations,
  telegramAccounts,
  users,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  OverlayBusyError,
  ShopInsufficientBalanceError,
  ShopInvalidDonationTextError,
  StreamDonationInvalidRequestError,
} from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";
import { createShopOrder, ensureShopCatalog } from "./shop.js";
import {
  STREAM_DONATION_PLAYING_LEASE_MS,
  attachStreamAlertConsumer,
  claimNextStreamDonation,
  completeStreamDonation,
  streamDonationDisplayName,
} from "./stream-donation.js";
import { provisionUser } from "./user.js";
import { apply, reconcileWallet } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
  await ensureShopCatalog(harness.db);
});

after(async () => {
  await harness.stop();
});

afterEach(async () => {
  await harness.db.delete(streamDonations);
  await harness.db.delete(streamAlertConsumers);
});

async function fund(userId: string, amount: bigint, key: string): Promise<void> {
  await apply(harness.db, {
    userId,
    type: "deposit",
    amountMinor: amount,
    idempotencyKey: key,
    actorType: "system",
  });
}

async function withTelegram(
  userId: string,
  telegramUserId: bigint,
  extras: { username?: string; firstName?: string } = {},
): Promise<void> {
  await harness.db.insert(telegramAccounts).values({
    userId,
    telegramUserId,
    username: extras.username ?? null,
    firstName: extras.firstName ?? null,
    isActive: true,
  });
}

async function buyDonat(
  userId: string,
  message: string,
  key: string,
  nickname = "Nick",
) {
  const order = await createShopOrder(harness.db, {
    userId,
    productCode: "donat",
    submittedData: { displayNickname: nickname, donationText: message },
    idempotencyKey: key,
  });
  const rows = await harness.db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.shopPurchaseId, order.orderId));
  return { order, donation: rows[0] };
}

test("display name prefers Telegram username then first name", () => {
  assert.equal(
    streamDonationDisplayName({
      username: "azarov",
      firstName: "Mikhail",
      displayName: "Other",
      telegramUserId: 99n,
    }),
    "@azarov",
  );
  assert.equal(
    streamDonationDisplayName({
      username: null,
      firstName: "Mikhail",
      displayName: "Other",
      telegramUserId: 99n,
    }),
    "Mikhail",
  );
  assert.equal(
    streamDonationDisplayName({
      username: null,
      firstName: null,
      displayName: null,
      telegramUserId: 12345n,
    }),
    "Игрок 12345",
  );
});

test("shop donat purchase debits 1000 once and creates one stream donation", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893001n, { username: "donor" });
  await fund(user.userId, 1500n, `dep:${user.userId}:1500`);
  const { order, donation } = await buyDonat(
    user.userId,
    "  hello stream  ",
    `shop:${user.userId}:donat-once`,
    "FormNick",
  );
  assert.equal(order.replayed, false);
  assert.equal(order.status, "fulfilled");
  assert.equal(order.priceAzc, "1000");
  assert.equal(order.newBalanceAzc, "500");
  assert.ok(donation);
  assert.equal(donation.status, "queued");
  assert.equal(donation.message, "hello stream");
  assert.equal(donation.displayName, "@donor");
  assert.equal(asBigInt(donation.amountAzc), 1000n);
  assert.equal(donation.shopPurchaseId, order.orderId);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.consistent, true);
  assert.equal(report.balanceMinor, 500n);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.filter((row) => row.type === "shop_purchase").length, 1);
  assert.equal(ledger.filter((row) => row.type === "stream_donation").length, 0);
});

test("insufficient shop donat balance creates neither purchase nor stream donation", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893002n, { firstName: "Poor" });
  await fund(user.userId, 999n, `dep:${user.userId}:999`);
  await assert.rejects(
    () =>
      buyDonat(user.userId, "nope", `shop:${user.userId}:low`),
    ShopInsufficientBalanceError,
  );
  const wallet = await harness.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.userId));
  assert.equal(asBigInt(wallet[0]?.balanceMinor ?? 0n), 999n);
  const rows = await harness.db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.userId, user.userId));
  assert.equal(rows.length, 0);
});

test("replayed shop donat does not debit or enqueue twice", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893003n, { username: "once" });
  await fund(user.userId, 3000n, `dep:${user.userId}:3000`);
  const key = `shop:${user.userId}:same`;
  const first = await buyDonat(user.userId, "first", key);
  const second = await buyDonat(user.userId, "second-should-not-apply", key);
  assert.equal(second.order.replayed, true);
  assert.equal(second.order.orderId, first.order.orderId);
  assert.equal(second.order.newBalanceAzc, "2000");
  const rows = await harness.db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.userId, user.userId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.message, "first");
  const debits = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(debits.filter((row) => row.type === "shop_purchase").length, 1);
  assert.equal(debits.filter((row) => row.type === "stream_donation").length, 0);
});

test("shop donation text validation stays on the shop flow", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893004n);
  await fund(user.userId, 2000n, `dep:${user.userId}:msg`);
  await assert.rejects(
    () => buyDonat(user.userId, "   ", `shop:${user.userId}:empty`),
    ShopInvalidDonationTextError,
  );
  await assert.rejects(
    () => buyDonat(user.userId, "x".repeat(301), `shop:${user.userId}:long`),
    ShopInvalidDonationTextError,
  );
});

test("other shop items do not enqueue stream donations", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 20_000n, `dep:${user.userId}:music`);
  const created = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "music",
    submittedData: { mediaUrl: "https://soundcloud.com/a/b" },
    idempotencyKey: `shop:${user.userId}:music`,
  });
  assert.equal(created.status, "pending");
  const rows = await harness.db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.userId, user.userId));
  assert.equal(rows.length, 0);
});

test("blocked user donat rolls back purchase and stream donation", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893008n, { username: "gone" });
  await fund(user.userId, 2000n, `dep:${user.userId}:blocked`);
  await harness.db
    .update(users)
    .set({ status: "blocked" })
    .where(eq(users.id, user.userId));
  await assert.rejects(
    () => buyDonat(user.userId, "hi", `shop:${user.userId}:blocked`),
    StreamDonationInvalidRequestError,
  );
  const rows = await harness.db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.userId, user.userId));
  assert.equal(rows.length, 0);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 2000n);
});

test("two donations claim FIFO and finished is not reissued", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893006n, { username: "fifo" });
  await fund(user.userId, 3000n, `dep:${user.userId}:fifo`);
  const a = await buyDonat(user.userId, "A", `shop:${user.userId}:fifo-a`);
  const b = await buyDonat(user.userId, "B", `shop:${user.userId}:fifo-b`);
  const session = randomUUID();
  await attachStreamAlertConsumer(harness.db, { sessionId: session });
  const first = await claimNextStreamDonation(harness.db, { sessionId: session });
  assert.equal(first.donation?.id, a.donation?.id);
  assert.equal(first.donation?.status, "playing");
  await completeStreamDonation(harness.db, {
    sessionId: session,
    donationId: a.donation!.id,
  });
  const second = await claimNextStreamDonation(harness.db, {
    sessionId: session,
  });
  assert.equal(second.donation?.id, b.donation?.id);
  await completeStreamDonation(harness.db, {
    sessionId: session,
    donationId: b.donation!.id,
  });
  const empty = await claimNextStreamDonation(harness.db, {
    sessionId: session,
  });
  assert.equal(empty.donation, null);
});

test("expired playing donation is recovered to the queue", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893007n, { username: "lease" });
  await fund(user.userId, 1000n, `dep:${user.userId}:lease`);
  const created = await buyDonat(
    user.userId,
    "hold",
    `shop:${user.userId}:lease`,
  );
  const session = randomUUID();
  let now = Date.parse("2026-10-07T09:00:00.000Z");
  const clock = { now: () => new Date(now) };
  await attachStreamAlertConsumer(harness.db, { sessionId: session, clock });
  const claimed = await claimNextStreamDonation(harness.db, {
    sessionId: session,
    clock,
  });
  assert.equal(claimed.donation?.id, created.donation?.id);
  now += STREAM_DONATION_PLAYING_LEASE_MS + 1_000;
  const laterSession = randomUUID();
  const attached = await attachStreamAlertConsumer(harness.db, {
    sessionId: laterSession,
    clock,
  });
  const recovered = await claimNextStreamDonation(harness.db, {
    sessionId: laterSession,
    clock,
  });
  assert.equal(attached.recovered + recovered.recovered, 1);
  assert.equal(recovered.donation?.id, created.donation?.id);
  assert.equal(recovered.donation?.status, "playing");
});

test("second overlay cannot steal the live queue", async () => {
  const session = randomUUID();
  await attachStreamAlertConsumer(harness.db, { sessionId: session });
  await assert.rejects(
    () => attachStreamAlertConsumer(harness.db, { sessionId: randomUUID() }),
    OverlayBusyError,
  );
});
