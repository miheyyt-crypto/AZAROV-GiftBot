import {
  jobs,
  notifications,
  purchases,
  streamAlertConsumers,
  streamDonations,
  streamGifSubmissions,
  telegramAccounts,
  walletTransactions,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { access, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  ShopStreamMediaNeedsModerationError,
  StreamGifAlreadyDecidedError,
  StreamGifNotPlayingError,
  StreamMediaNotReadyError,
  StreamMediaUnsupportedFormatError,
} from "./errors.js";
import { minimalTestGif, STREAM_GIF_STAGING_TTL_MS } from "./gif-inspect.js";
import { minimalTestJpeg } from "./media-inspect.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";
import { createShopOrder, ensureShopCatalog, fulfillShopOrder } from "./shop.js";
import {
  approveStreamGif,
  dismissPlayingStreamGif,
  rejectStreamGif,
  stageStreamGifUpload,
} from "./stream-gif.js";
import { createStreamGifFileStorage } from "./stream-gif-storage.js";
import {
  attachStreamAlertConsumer,
  claimNextStreamDonation,
  completeStreamDonation,
} from "./stream-donation.js";
import { provisionUser } from "./user.js";
import { apply, reconcileWallet } from "./wallet.js";

let harness: DomainHarness;
let storageDir: string;
let storage: ReturnType<typeof createStreamGifFileStorage>;

before(async () => {
  harness = await startDomainHarness();
  await ensureShopCatalog(harness.db);
  storageDir = await mkdtemp(join(tmpdir(), "giftbot-gif-"));
  storage = createStreamGifFileStorage(storageDir);
});

after(async () => {
  await harness.stop();
  await rm(storageDir, { recursive: true, force: true });
});

afterEach(async () => {
  await harness.db.delete(streamGifSubmissions);
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

async function withTelegram(userId: string, telegramUserId: bigint): Promise<void> {
  await harness.db.insert(telegramAccounts).values({
    userId,
    telegramUserId,
    username: "gifuser",
    firstName: "Gif",
    isActive: true,
  });
}

async function buyGif(userId: string, key: string) {
  const staged = await stageStreamGifUpload(harness.db, storage, {
    userId,
    bytes: minimalTestGif(),
    contentType: "image/gif",
  });
  const order = await createShopOrder(harness.db, {
    userId,
    productCode: "gif-stream",
    submittedData: { gifUploadId: staged.uploadId },
    idempotencyKey: key,
  });
  return { staged, order };
}

test("GIF purchase debits 1000 once, stays on moderation, and does not enqueue OBS", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 910001n);
  await fund(user.userId, 1500n, `dep:${user.userId}:gif`);
  const first = await buyGif(user.userId, `shop:${user.userId}:gif-once`);
  assert.equal(first.order.replayed, false);
  assert.equal(first.order.status, "pending");
  assert.equal(first.order.priceAzc, "1000");
  assert.equal(first.order.newBalanceAzc, "500");
  const replay = await buyGif(user.userId, `shop:${user.userId}:gif-once`);
  assert.equal(replay.order.replayed, true);
  assert.equal(replay.order.orderId, first.order.orderId);
  const donations = await harness.db.select().from(streamDonations);
  assert.equal(donations.length, 0);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 500n);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.filter((row) => row.type === "shop_purchase").length, 1);
});

test("unsupported bytes are rejected before a shop debit; JPEG stages", async () => {
  const user = await provisionUser(harness.db);
  await fund(user.userId, 1000n, `dep:${user.userId}:badgif`);
  await assert.rejects(
    () =>
      stageStreamGifUpload(harness.db, storage, {
        userId: user.userId,
        bytes: Buffer.from("not-a-media-file"),
        contentType: "image/gif",
      }),
    StreamMediaUnsupportedFormatError,
  );
  const staged = await stageStreamGifUpload(harness.db, storage, {
    userId: user.userId,
    bytes: minimalTestJpeg(),
  });
  assert.equal(staged.contentType, "image/jpeg");
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 1000n);
});

test("a later upload does not delete pending_moderation staging still referenced in DB", async () => {
  const user = await provisionUser(harness.db);
  const first = await stageStreamGifUpload(harness.db, storage, {
    userId: user.userId,
    bytes: minimalTestJpeg(),
  });
  const rows = await harness.db
    .select()
    .from(streamGifSubmissions)
    .where(eq(streamGifSubmissions.id, first.uploadId));
  const key = rows[0]?.stagingStorageKey;
  assert.ok(key);
  const abs = storage.resolvePath(key);
  const old = new Date(Date.now() - STREAM_GIF_STAGING_TTL_MS - 60_000);
  await utimes(abs, old, old);
  await stageStreamGifUpload(harness.db, storage, {
    userId: user.userId,
    bytes: minimalTestGif(),
  });
  await access(abs);
});

test("shop fulfill cannot skip gif-stream moderation; delivered order still approves once", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 910011n);
  await fund(user.userId, 1000n, `dep:${user.userId}:ful-bypass`);
  const bought = await buyGif(user.userId, `shop:${user.userId}:ful-bypass`);
  await assert.rejects(
    () =>
      fulfillShopOrder(harness.db, {
        orderId: bought.order.orderId,
        adminUserId: admin.userId,
        idempotencyKey: `shop.fulfill:${bought.order.orderId}`,
      }),
    ShopStreamMediaNeedsModerationError,
  );
  await harness.db
    .update(purchases)
    .set({ status: "delivered", fulfilledAt: new Date(), updatedAt: new Date() })
    .where(eq(purchases.id, bought.order.orderId));
  const first = await approveStreamGif(harness.db, storage, {
    submissionId: bought.staged.uploadId,
    adminUserId: admin.userId,
    idempotencyKey: `gif.approve:${bought.staged.uploadId}:ful`,
  });
  assert.equal(first.enqueued, true);
  const second = await approveStreamGif(harness.db, storage, {
    submissionId: bought.staged.uploadId,
    adminUserId: admin.userId,
    idempotencyKey: `gif.approve:${bought.staged.uploadId}:ful-2`,
  });
  assert.equal(second.replayed, true);
  assert.equal(second.enqueued, false);
  const donations = await harness.db.select().from(streamDonations);
  assert.equal(donations.length, 1);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 0n);
});

test("reject refunds a delivered gif-stream still pending_moderation without OBS once", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 910021n);
  await fund(user.userId, 1000n, `dep:${user.userId}:del-rej`);
  const bought = await buyGif(user.userId, `shop:${user.userId}:del-rej`);
  await harness.db
    .update(purchases)
    .set({ status: "delivered", fulfilledAt: new Date(), updatedAt: new Date() })
    .where(eq(purchases.id, bought.order.orderId));
  const first = await rejectStreamGif(harness.db, storage, {
    submissionId: bought.staged.uploadId,
    adminUserId: admin.userId,
    reason: "file missing",
    idempotencyKey: `gif.reject:${bought.staged.uploadId}:del`,
  });
  assert.equal(first.replayed, false);
  assert.equal(first.item.status, "rejected");
  const second = await rejectStreamGif(harness.db, storage, {
    submissionId: bought.staged.uploadId,
    adminUserId: admin.userId,
    reason: "file missing again",
    idempotencyKey: `gif.reject:${bought.staged.uploadId}:del-2`,
  });
  assert.equal(second.replayed, true);
  const refunds = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(refunds.filter((row) => row.type === "shop_refund").length, 1);
  assert.ok(
    refunds.some(
      (row) =>
        row.type === "shop_refund" &&
        row.idempotencyKey === `shop.refund:${bought.order.orderId}` &&
        asBigInt(row.amountMinor) === 1000n,
    ),
  );
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 1000n);
  const orderRows = await harness.db
    .select()
    .from(purchases)
    .where(eq(purchases.id, bought.order.orderId));
  assert.equal(orderRows[0]?.status, "refunded");
  const donations = await harness.db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.shopPurchaseId, bought.order.orderId));
  assert.equal(donations.length, 0);
});

test("concurrent approve and reject on delivered gif-stream cannot both enqueue and refund", async () => {
  const adminA = await provisionUser(harness.db);
  const adminB = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 910022n);
  await fund(user.userId, 1000n, `dep:${user.userId}:del-race`);
  const bought = await buyGif(user.userId, `shop:${user.userId}:del-race`);
  await harness.db
    .update(purchases)
    .set({ status: "delivered", fulfilledAt: new Date(), updatedAt: new Date() })
    .where(eq(purchases.id, bought.order.orderId));
  const results = await Promise.allSettled([
    approveStreamGif(harness.db, storage, {
      submissionId: bought.staged.uploadId,
      adminUserId: adminA.userId,
      idempotencyKey: `gif.approve:${bought.staged.uploadId}:del-race`,
    }),
    rejectStreamGif(harness.db, storage, {
      submissionId: bought.staged.uploadId,
      adminUserId: adminB.userId,
      reason: "no",
      idempotencyKey: `gif.reject:${bought.staged.uploadId}:del-race`,
    }),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  const donations = await harness.db.select().from(streamDonations);
  const refunds = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  const refundCount = refunds.filter((row) => row.type === "shop_refund").length;
  assert.equal(donations.length + refundCount, 1);
});

test("approve enqueues GIF once without a second debit; reject after approve is blocked", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 910002n);
  await fund(user.userId, 1000n, `dep:${user.userId}:appr`);
  const bought = await buyGif(user.userId, `shop:${user.userId}:appr`);
  const first = await approveStreamGif(harness.db, storage, {
    submissionId: bought.staged.uploadId,
    adminUserId: admin.userId,
    idempotencyKey: `gif.approve:${bought.staged.uploadId}:a`,
  });
  assert.equal(first.replayed, false);
  assert.equal(first.enqueued, true);
  assert.equal(first.item.status, "queued");
  const second = await approveStreamGif(harness.db, storage, {
    submissionId: bought.staged.uploadId,
    adminUserId: admin.userId,
    idempotencyKey: `gif.approve:${bought.staged.uploadId}:b`,
  });
  assert.equal(second.replayed, true);
  assert.equal(second.enqueued, false);
  const donations = await harness.db.select().from(streamDonations);
  assert.equal(donations.length, 1);
  assert.equal(donations[0]?.kind, "gif");
  assert.equal(donations[0]?.ttsStatus, "skipped");
  const ttsJobs = await harness.db.select().from(jobs);
  assert.equal(
    ttsJobs.filter((row) => row.type === "stream_alert.synthesize_tts").length,
    0,
  );
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 0n);
  await assert.rejects(
    () =>
      rejectStreamGif(harness.db, storage, {
        submissionId: bought.staged.uploadId,
        adminUserId: admin.userId,
        reason: "too late",
        idempotencyKey: `gif.reject:${bought.staged.uploadId}`,
      }),
    StreamGifAlreadyDecidedError,
  );
});

test("concurrent reject refunds 1000 AZC once and notifies", async () => {
  const adminA = await provisionUser(harness.db);
  const adminB = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 910003n);
  await fund(user.userId, 1000n, `dep:${user.userId}:rej`);
  const bought = await buyGif(user.userId, `shop:${user.userId}:rej`);
  const results = await Promise.allSettled([
    rejectStreamGif(harness.db, storage, {
      submissionId: bought.staged.uploadId,
      adminUserId: adminA.userId,
      reason: "one",
      idempotencyKey: `gif.reject:${bought.staged.uploadId}:1`,
    }),
    rejectStreamGif(harness.db, storage, {
      submissionId: bought.staged.uploadId,
      adminUserId: adminB.userId,
      reason: "two",
      idempotencyKey: `gif.reject:${bought.staged.uploadId}:2`,
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  assert.equal(ok.length, 2);
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 1000n);
  const refunds = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(refunds.filter((row) => row.type === "shop_refund").length, 1);
  const inbox = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId));
  assert.ok(inbox.some((row) => row.type === "shop_order_rejected"));
});

test("old overlay skips queued GIF and still claims a later donation", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 910007n);
  await fund(user.userId, 2500n, `dep:${user.userId}:oldov`);
  const bought = await buyGif(user.userId, `shop:${user.userId}:oldov-gif`);
  await approveStreamGif(harness.db, storage, {
    submissionId: bought.staged.uploadId,
    adminUserId: admin.userId,
    idempotencyKey: `gif.approve:${bought.staged.uploadId}:oldov`,
  });
  const donat = await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "donat",
    submittedData: { displayNickname: "Nick", donationText: "later" },
    idempotencyKey: `shop:${user.userId}:oldov-donat`,
  });
  const sessionId = randomUUID();
  await attachStreamAlertConsumer(harness.db, { sessionId });
  const claimed = await claimNextStreamDonation(harness.db, { sessionId });
  assert.equal(claimed.donation?.kind, "donation");
  assert.equal(claimed.donation?.message, "later");
  const stillQueued = await harness.db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.shopPurchaseId, bought.order.orderId));
  assert.equal(stillQueued[0]?.status, "queued");
  assert.equal(stillQueued[0]?.kind, "gif");
});

test("approved GIF is claimed after earlier donations; load-fail complete is not success", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 910004n);
  await fund(user.userId, 2500n, `dep:${user.userId}:ord`);
  await createShopOrder(harness.db, {
    userId: user.userId,
    productCode: "donat",
    submittedData: { displayNickname: "Nick", donationText: "hello" },
    idempotencyKey: `shop:${user.userId}:donat-first`,
  });
  const bought = await buyGif(user.userId, `shop:${user.userId}:gif-second`);
  const sessionId = randomUUID();
  await attachStreamAlertConsumer(harness.db, { sessionId });
  const beforeApprove = await claimNextStreamDonation(harness.db, { sessionId });
  assert.equal(beforeApprove.donation?.kind, "donation");
  await completeStreamDonation(harness.db, {
    sessionId,
    donationId: beforeApprove.donation!.id,
  });
  await approveStreamGif(harness.db, storage, {
    submissionId: bought.staged.uploadId,
    adminUserId: admin.userId,
    idempotencyKey: `gif.approve:${bought.staged.uploadId}`,
  });
  const skipped = await claimNextStreamDonation(harness.db, { sessionId });
  assert.equal(skipped.donation, null);
  const gifClaim = await claimNextStreamDonation(harness.db, {
    sessionId,
    supportsGif: true,
  });
  assert.equal(gifClaim.donation?.kind, "gif");
  const failed = await completeStreamDonation(harness.db, {
    sessionId,
    donationId: gifClaim.donation!.id,
    playbackOutcome: "failed",
  });
  assert.equal(failed.status, "finished");
  assert.equal(failed.playbackOutcome, "failed");
});

test("competing approve and reject cannot both enqueue and refund", async () => {
  const adminA = await provisionUser(harness.db);
  const adminB = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 910006n);
  await fund(user.userId, 1000n, `dep:${user.userId}:race`);
  const bought = await buyGif(user.userId, `shop:${user.userId}:race`);
  const results = await Promise.allSettled([
    approveStreamGif(harness.db, storage, {
      submissionId: bought.staged.uploadId,
      adminUserId: adminA.userId,
      idempotencyKey: `gif.approve:${bought.staged.uploadId}:race`,
    }),
    rejectStreamGif(harness.db, storage, {
      submissionId: bought.staged.uploadId,
      adminUserId: adminB.userId,
      reason: "no",
      idempotencyKey: `gif.reject:${bought.staged.uploadId}:race`,
    }),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  const donations = await harness.db.select().from(streamDonations);
  const refunds = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  const refundCount = refunds.filter((row) => row.type === "shop_refund").length;
  assert.equal(donations.length + refundCount, 1);
});

test("dismiss current GIF finishes playing and unblocks the queue", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 910005n);
  await fund(user.userId, 1000n, `dep:${user.userId}:dis`);
  const bought = await buyGif(user.userId, `shop:${user.userId}:dis`);
  await approveStreamGif(harness.db, storage, {
    submissionId: bought.staged.uploadId,
    adminUserId: admin.userId,
    idempotencyKey: `gif.approve:${bought.staged.uploadId}`,
  });
  const sessionId = randomUUID();
  await attachStreamAlertConsumer(harness.db, { sessionId });
  const claimed = await claimNextStreamDonation(harness.db, {
    sessionId,
    supportsGif: true,
  });
  assert.equal(claimed.donation?.status, "playing");
  const dismissed = await dismissPlayingStreamGif(harness.db, {
    adminUserId: admin.userId,
  });
  assert.equal(dismissed.donationId, claimed.donation?.id);
  await assert.rejects(
    () => dismissPlayingStreamGif(harness.db, { adminUserId: admin.userId }),
    StreamGifNotPlayingError,
  );
  const replay = await completeStreamDonation(harness.db, {
    sessionId,
    donationId: claimed.donation!.id,
    playbackOutcome: "succeeded",
  });
  assert.equal(replay.playbackOutcome, "dismissed");
});

test("purchase is blocked until playback is prepared", async () => {
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 920017n);
  await fund(user.userId, 1000n, `dep:${user.userId}:prep`);
  const staged = await stageStreamGifUpload(harness.db, storage, {
    userId: user.userId,
    bytes: minimalTestJpeg(),
  });
  await harness.db
    .update(streamGifSubmissions)
    .set({ playbackReady: false })
    .where(eq(streamGifSubmissions.id, staged.uploadId));
  await assert.rejects(
    () =>
      createShopOrder(harness.db, {
        userId: user.userId,
        productCode: "gif-stream",
        submittedData: { gifUploadId: staged.uploadId },
        idempotencyKey: `shop:${user.userId}:prep`,
      }),
    StreamMediaNotReadyError,
  );
  const report = await reconcileWallet(harness.db, user.userId);
  assert.equal(report.balanceMinor, 1000n);
});

test("supportsGif does not claim video media", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await withTelegram(user.userId, 920008n);
  await fund(user.userId, 1000n, `dep:${user.userId}:vid`);
  const bought = await buyGif(user.userId, `shop:${user.userId}:vid`);
  await approveStreamGif(harness.db, storage, {
    submissionId: bought.staged.uploadId,
    adminUserId: admin.userId,
    idempotencyKey: `gif.approve:${bought.staged.uploadId}`,
  });
  await harness.db
    .update(streamDonations)
    .set({ mediaContentType: "video/mp4" })
    .where(eq(streamDonations.shopPurchaseId, bought.order.orderId));
  const sessionId = randomUUID();
  await attachStreamAlertConsumer(harness.db, { sessionId });
  const skipped = await claimNextStreamDonation(harness.db, {
    sessionId,
    supportsGif: true,
  });
  assert.equal(skipped.donation, null);
  const claimed = await claimNextStreamDonation(harness.db, {
    sessionId,
    supportsGif: true,
    supportsVideo: true,
  });
  assert.equal(claimed.donation?.kind, "gif");
  assert.equal(claimed.donation?.mediaContentType, "video/mp4");
});
