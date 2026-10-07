import {
  streamAlertConsumers,
  streamDonations,
  telegramAccounts,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  InsufficientFundsError,
  OverlayBusyError,
  StreamDonationInvalidMessageError,
  StreamDonationInvalidRequestError,
} from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";
import {
  STREAM_DONATION_PLAYING_LEASE_MS,
  attachStreamAlertConsumer,
  claimNextStreamDonation,
  completeStreamDonation,
  createStreamDonation,
  streamDonationDisplayName,
} from "./stream-donation.js";
import { provisionUser } from "./user.js";
import { apply, reconcileWallet } from "./wallet.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
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

test("1500 AZC donation leaves 500 and creates queued row", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893001n, { username: "donor" });
  await fund(user.userId, 1500n, `dep:${user.userId}:1500`);
  const created = await createStreamDonation(harness.db, {
    userId: user.userId,
    message: "  hello stream  ",
    clientRequestId: randomUUID(),
  });
  assert.equal(created.replayed, false);
  assert.equal(created.amountAzc, "1000");
  assert.equal(created.status, "queued");
  assert.equal(created.message, "hello stream");
  assert.equal(created.displayName, "@donor");
  assert.equal(created.newBalanceAzc, "500");
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.consistent, true);
  assert.equal(report.balanceMinor, 500n);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.ok(ledger.some((row) => row.type === "stream_donation"));
  assert.equal(
    asBigInt(
      ledger.find((row) => row.type === "stream_donation")?.amountMinor ?? 0n,
    ),
    -1000n,
  );
});

test("999 AZC donation is rejected and balance is unchanged", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893002n, { firstName: "Poor" });
  await fund(user.userId, 999n, `dep:${user.userId}:999`);
  await assert.rejects(
    () =>
      createStreamDonation(harness.db, {
        userId: user.userId,
        message: "nope",
        clientRequestId: randomUUID(),
      }),
    InsufficientFundsError,
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

test("duplicate clientRequestId creates one donation and one debit", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893003n, { username: "once" });
  await fund(user.userId, 3000n, `dep:${user.userId}:3000`);
  const key = randomUUID();
  const first = await createStreamDonation(harness.db, {
    userId: user.userId,
    message: "first",
    clientRequestId: key,
  });
  const second = await createStreamDonation(harness.db, {
    userId: user.userId,
    message: "second-should-not-apply",
    clientRequestId: key,
  });
  assert.equal(second.replayed, true);
  assert.equal(second.id, first.id);
  assert.equal(second.message, "first");
  assert.equal(second.newBalanceAzc, "2000");
  const rows = await harness.db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.userId, user.userId));
  assert.equal(rows.length, 1);
  const debits = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(debits.filter((row) => row.type === "stream_donation").length, 1);
});

test("empty and oversized messages are rejected", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893004n);
  await fund(user.userId, 2000n, `dep:${user.userId}:msg`);
  await assert.rejects(
    () =>
      createStreamDonation(harness.db, {
        userId: user.userId,
        message: "   ",
        clientRequestId: randomUUID(),
      }),
    StreamDonationInvalidMessageError,
  );
  await assert.rejects(
    () =>
      createStreamDonation(harness.db, {
        userId: user.userId,
        message: "x".repeat(201),
        clientRequestId: randomUUID(),
      }),
    StreamDonationInvalidMessageError,
  );
});

test("client cannot spoof userId or display name", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893005n, { username: "real" });
  await fund(user.userId, 2000n, `dep:${user.userId}:spoof`);
  await assert.rejects(
    () =>
      createStreamDonation(harness.db, {
        userId: user.userId,
        message: "hi",
        clientRequestId: randomUUID(),
        submittedUserId: randomUUID(),
      }),
    StreamDonationInvalidRequestError,
  );
  await assert.rejects(
    () =>
      createStreamDonation(harness.db, {
        userId: user.userId,
        message: "hi",
        clientRequestId: randomUUID(),
        submittedDisplayName: "@hacker",
      }),
    StreamDonationInvalidRequestError,
  );
});

test("two donations claim FIFO and finished is not reissued", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 893006n, { username: "fifo" });
  await fund(user.userId, 3000n, `dep:${user.userId}:fifo`);
  const a = await createStreamDonation(harness.db, {
    userId: user.userId,
    message: "A",
    clientRequestId: randomUUID(),
  });
  const b = await createStreamDonation(harness.db, {
    userId: user.userId,
    message: "B",
    clientRequestId: randomUUID(),
  });
  const session = randomUUID();
  await attachStreamAlertConsumer(harness.db, { sessionId: session });
  const first = await claimNextStreamDonation(harness.db, { sessionId: session });
  assert.equal(first.donation?.id, a.id);
  assert.equal(first.donation?.status, "playing");
  await completeStreamDonation(harness.db, {
    sessionId: session,
    donationId: a.id,
  });
  const second = await claimNextStreamDonation(harness.db, {
    sessionId: session,
  });
  assert.equal(second.donation?.id, b.id);
  await completeStreamDonation(harness.db, {
    sessionId: session,
    donationId: b.id,
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
  const created = await createStreamDonation(harness.db, {
    userId: user.userId,
    message: "hold",
    clientRequestId: randomUUID(),
  });
  const session = randomUUID();
  let now = Date.parse("2026-10-07T09:00:00.000Z");
  const clock = { now: () => new Date(now) };
  await attachStreamAlertConsumer(harness.db, { sessionId: session, clock });
  const claimed = await claimNextStreamDonation(harness.db, {
    sessionId: session,
    clock,
  });
  assert.equal(claimed.donation?.id, created.id);
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
  assert.equal(recovered.donation?.id, created.id);
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
