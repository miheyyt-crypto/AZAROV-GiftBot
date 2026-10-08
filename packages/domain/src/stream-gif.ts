import {
  notifications,
  purchases,
  streamDonations,
  streamGifSubmissions,
  users,
  wallets,
} from "@giftbot/db/schema";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { writeAuditIn } from "./admin.js";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  ShopInvalidGifUploadError,
  ShopRejectionReasonRequiredError,
  StreamGifAlreadyDecidedError,
  StreamGifInvalidFileError,
  StreamGifNotFoundError,
  StreamGifNotPlayingError,
  StreamGifUploadNotFoundError,
  WalletNotFoundError,
} from "./errors.js";
import {
  inspectGif,
  STREAM_GIF_MESSAGE,
  STREAM_GIF_SHOP_PRODUCT_CODE,
  STREAM_GIF_STAGING_TTL_MS,
} from "./gif-inspect.js";
import { asBigInt } from "./money.js";
import { assertTransition, shopOrderTransitions } from "./states.js";
import { enqueueStreamDonationIn } from "./stream-donation.js";
import type { StreamGifFileStorage } from "./stream-gif-storage.js";
import { applyIn } from "./wallet.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StreamGifDisplayStatus =
  | "pending_moderation"
  | "queued"
  | "playing"
  | "shown"
  | "rejected";

export type StreamGifSubmissionView = {
  id: string;
  userId: string;
  publicId: string | null;
  displayName: string | null;
  orderId: string | null;
  donationId: string | null;
  status: StreamGifDisplayStatus;
  playbackOutcome: string | null;
  width: number;
  height: number;
  frameCount: number;
  byteSize: number;
  rejectionReason: string | null;
  createdAt: string;
  moderatedAt: string | null;
};

export function parseShopGifUploadId(raw: unknown): string {
  if (typeof raw !== "string" || !UUID_RE.test(raw.trim())) {
    throw new ShopInvalidGifUploadError();
  }
  return raw.trim();
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function displayStatus(
  submission: typeof streamGifSubmissions.$inferSelect,
  donation: typeof streamDonations.$inferSelect | undefined,
): StreamGifDisplayStatus {
  if (submission.status === "rejected") {
    return "rejected";
  }
  if (donation?.status === "playing") {
    return "playing";
  }
  if (donation?.status === "finished") {
    return "shown";
  }
  if (submission.status === "queued" || donation?.status === "queued") {
    return "queued";
  }
  return "pending_moderation";
}

async function loadPublicUser(
  tx: GiftbotTx | GiftbotDb,
  userId: string,
): Promise<{ publicId: string | null; displayName: string | null }> {
  const rows = await tx
    .select({ publicId: users.publicId, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  return {
    publicId: row?.publicId ?? null,
    displayName: row?.displayName ?? null,
  };
}

function serialize(
  submission: typeof streamGifSubmissions.$inferSelect,
  extra: {
    publicId: string | null;
    displayName: string | null;
    donation?: typeof streamDonations.$inferSelect;
  },
): StreamGifSubmissionView {
  return {
    id: submission.id,
    userId: submission.userId,
    publicId: extra.publicId,
    displayName: extra.displayName,
    orderId: submission.shopPurchaseId,
    donationId: extra.donation?.id ?? submission.streamDonationId,
    status: displayStatus(submission, extra.donation),
    playbackOutcome: extra.donation?.playbackOutcome ?? null,
    width: submission.width,
    height: submission.height,
    frameCount: submission.frameCount,
    byteSize: submission.byteSize,
    rejectionReason: submission.rejectionReason,
    createdAt: submission.createdAt.toISOString(),
    moderatedAt: toIso(submission.moderatedAt),
  };
}

export async function stageStreamGifUpload(
  db: GiftbotDb,
  storage: StreamGifFileStorage,
  input: { userId: string; bytes: Buffer; contentType?: string },
): Promise<{ uploadId: string; width: number; height: number; frameCount: number }> {
  if (input.contentType && input.contentType !== "image/gif") {
    throw new StreamGifInvalidFileError("contentType must be image/gif");
  }
  const inspected = inspectGif(input.bytes);
  await storage.cleanupStaging();
  const stored = await storage.putStaging({
    userId: input.userId,
    bytes: input.bytes,
  });
  const inserted = await db
    .insert(streamGifSubmissions)
    .values({
      userId: input.userId,
      status: "staging",
      stagingStorageKey: stored.storageKey,
      contentType: "image/gif",
      byteSize: input.bytes.byteLength,
      width: inspected.width,
      height: inspected.height,
      frameCount: inspected.frameCount,
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to stage GIF upload");
  }
  return {
    uploadId: row.id,
    width: inspected.width,
    height: inspected.height,
    frameCount: inspected.frameCount,
  };
}

export async function consumeStreamGifUploadIn(
  tx: GiftbotTx,
  input: { userId: string; uploadId: string; purchaseId: string },
): Promise<void> {
  const rows = await tx
    .select()
    .from(streamGifSubmissions)
    .where(
      and(
        eq(streamGifSubmissions.id, input.uploadId),
        eq(streamGifSubmissions.userId, input.userId),
      ),
    )
    .limit(1)
    .for("update");
  const row = rows[0];
  if (!row || row.status !== "staging" || row.shopPurchaseId) {
    throw new StreamGifUploadNotFoundError();
  }
  const now = new Date();
  await tx
    .update(streamGifSubmissions)
    .set({
      shopPurchaseId: input.purchaseId,
      status: "pending_moderation",
      consumedAt: now,
      updatedAt: now,
    })
    .where(eq(streamGifSubmissions.id, row.id));
}

export async function listAdminStreamGifs(
  db: GiftbotDb,
): Promise<StreamGifSubmissionView[]> {
  const rows = await db
    .select({
      submission: streamGifSubmissions,
      donation: streamDonations,
      publicId: users.publicId,
      displayName: users.displayName,
    })
    .from(streamGifSubmissions)
    .innerJoin(users, eq(users.id, streamGifSubmissions.userId))
    .leftJoin(
      streamDonations,
      eq(streamDonations.id, streamGifSubmissions.streamDonationId),
    )
    .where(
      or(
        eq(streamGifSubmissions.status, "pending_moderation"),
        eq(streamGifSubmissions.status, "queued"),
        eq(streamGifSubmissions.status, "rejected"),
      ),
    )
    .orderBy(desc(streamGifSubmissions.createdAt))
    .limit(80);
  return rows.map((row) =>
    serialize(row.submission, {
      publicId: row.publicId,
      displayName: row.displayName,
      ...(row.donation ? { donation: row.donation } : {}),
    }),
  );
}

export async function getStreamGifSubmission(
  db: GiftbotDb,
  id: string,
): Promise<typeof streamGifSubmissions.$inferSelect | undefined> {
  if (!UUID_RE.test(id)) {
    throw new StreamGifNotFoundError();
  }
  const rows = await db
    .select()
    .from(streamGifSubmissions)
    .where(eq(streamGifSubmissions.id, id))
    .limit(1);
  return rows[0];
}

export async function approveStreamGif(
  db: GiftbotDb,
  storage: StreamGifFileStorage,
  input: { submissionId: string; adminUserId: string; idempotencyKey: string },
): Promise<{ item: StreamGifSubmissionView; replayed: boolean; enqueued: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(streamGifSubmissions)
      .where(eq(streamGifSubmissions.id, input.submissionId))
      .limit(1)
      .for("update");
    const current = rows[0];
    if (!current || !current.shopPurchaseId) {
      throw new StreamGifNotFoundError();
    }
    if (current.status === "rejected") {
      throw new StreamGifAlreadyDecidedError();
    }
    const identity = await loadPublicUser(tx, current.userId);
    if (current.status === "queued" && current.streamDonationId) {
      const donationRows = await tx
        .select()
        .from(streamDonations)
        .where(eq(streamDonations.id, current.streamDonationId))
        .limit(1);
      return {
        item: serialize(current, {
          ...identity,
          ...(donationRows[0] ? { donation: donationRows[0] } : {}),
        }),
        replayed: true,
        enqueued: false,
      };
    }
    const orderRows = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, current.shopPurchaseId))
      .limit(1)
      .for("update");
    const order = orderRows[0];
    if (!order) {
      throw new StreamGifNotFoundError();
    }
    const from =
      order.status === "delivered"
        ? "fulfilled"
        : order.status === "refunded"
          ? "rejected"
          : order.status === "paid"
            ? "processing"
            : "pending";
    if (from === "rejected") {
      throw new StreamGifAlreadyDecidedError();
    }
    const promoted = await storage.promoteAccepted(
      current.stagingStorageKey,
      current.userId,
    );
    const walletRows = await tx
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, current.userId))
      .limit(1);
    if (!walletRows[0]) {
      throw new WalletNotFoundError();
    }
    if (!order.walletTransactionId) {
      throw new WalletNotFoundError();
    }
    const donation = await enqueueStreamDonationIn(tx, {
      userId: current.userId,
      purchaseId: current.shopPurchaseId,
      walletTransactionId: order.walletTransactionId,
      message: STREAM_GIF_MESSAGE,
      amountAzc: asBigInt(order.priceMinor),
      kind: "gif",
      mediaStorageKey: promoted.storageKey,
      mediaWidth: current.width,
      mediaHeight: current.height,
      mediaFrameCount: current.frameCount,
    });
    const now = new Date();
    if (from !== "fulfilled") {
      assertTransition("shop_order", shopOrderTransitions, from, "fulfilled");
      await tx
        .update(purchases)
        .set({
          status: "delivered",
          fulfilledAt: now,
          updatedAt: now,
          processedByAdminId: input.adminUserId,
        })
        .where(eq(purchases.id, order.id));
      await writeAuditIn(tx, {
        actorId: input.adminUserId,
        action: "shop_order.fulfilled",
        targetType: "shop_order",
        targetId: order.id,
        reason: "approve stream GIF",
        before: { status: from, userId: order.userId },
        after: { status: "fulfilled", productCode: STREAM_GIF_SHOP_PRODUCT_CODE },
      });
      await tx.insert(notifications).values({
        userId: current.userId,
        channel: "inbox",
        type: "shop_order_fulfilled",
        status: "sent",
        title: "GIF одобрен",
        body: "GIF поставлен в очередь на стрим",
        sentAt: now,
        payload: { orderId: order.id },
      });
    }
    const updated = await tx
      .update(streamGifSubmissions)
      .set({
        status: "queued",
        acceptedStorageKey: promoted.storageKey,
        streamDonationId: donation.id,
        moderatedByAdminId: input.adminUserId,
        moderatedAt: now,
        updatedAt: now,
      })
      .where(eq(streamGifSubmissions.id, current.id))
      .returning();
    const next = updated[0] ?? current;
    return {
      item: serialize(next, { ...identity }),
      replayed: donation.replayed,
      enqueued: !donation.replayed,
    };
  });
}

export async function rejectStreamGif(
  db: GiftbotDb,
  storage: StreamGifFileStorage,
  input: {
    submissionId: string;
    adminUserId: string;
    reason: unknown;
    idempotencyKey: string;
  },
): Promise<{ item: StreamGifSubmissionView; replayed: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  if (typeof input.reason !== "string") {
    throw new ShopRejectionReasonRequiredError();
  }
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 500) {
    throw new ShopRejectionReasonRequiredError();
  }
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(streamGifSubmissions)
      .where(eq(streamGifSubmissions.id, input.submissionId))
      .limit(1)
      .for("update");
    const current = rows[0];
    if (!current || !current.shopPurchaseId) {
      throw new StreamGifNotFoundError();
    }
    const identity = await loadPublicUser(tx, current.userId);
    if (current.status === "rejected") {
      return { item: serialize(current, identity), replayed: true };
    }
    if (current.status === "queued" || current.streamDonationId) {
      throw new StreamGifAlreadyDecidedError();
    }
    const orderRows = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, current.shopPurchaseId))
      .limit(1)
      .for("update");
    const order = orderRows[0];
    if (!order) {
      throw new StreamGifNotFoundError();
    }
    const from =
      order.status === "delivered"
        ? "fulfilled"
        : order.status === "refunded"
          ? "rejected"
          : order.status === "paid"
            ? "processing"
            : "pending";
    if (from === "rejected") {
      const nowRejected = new Date();
      const synced = await tx
        .update(streamGifSubmissions)
        .set({
          status: "rejected",
          rejectionReason: order.rejectionReason ?? reason,
          moderatedByAdminId: input.adminUserId,
          moderatedAt: nowRejected,
          updatedAt: nowRejected,
        })
        .where(eq(streamGifSubmissions.id, current.id))
        .returning();
      return {
        item: serialize(synced[0] ?? current, identity),
        replayed: true,
      };
    }
    assertTransition("shop_order", shopOrderTransitions, from, "rejected");
    const price = asBigInt(order.priceMinor);
    await applyIn(tx, {
      userId: current.userId,
      type: "shop_refund",
      amountMinor: price,
      idempotencyKey: `shop.refund:${order.id}`,
      actorType: "admin",
      actorId: input.adminUserId,
      referenceType: "purchase",
      referenceId: order.id,
      reason,
      metadata: {
        orderId: order.id,
        productCode: STREAM_GIF_SHOP_PRODUCT_CODE,
        originalPriceAzc: price.toString(),
        rejectionReason: reason,
      },
    });
    const now = new Date();
    await tx
      .update(purchases)
      .set({
        status: "refunded",
        rejectionReason: reason,
        rejectedAt: now,
        updatedAt: now,
        processedByAdminId: input.adminUserId,
      })
      .where(eq(purchases.id, order.id));
    await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "shop_order.rejected",
      targetType: "shop_order",
      targetId: order.id,
      reason,
      before: { status: from, userId: order.userId },
      after: { status: "rejected", refundedAzc: price.toString() },
    });
    await tx.insert(notifications).values({
      userId: current.userId,
      channel: "inbox",
      type: "shop_order_rejected",
      status: "sent",
      title: "GIF отклонён",
      body: `GIF отклонён. Возвращено ${price.toString()} AZC. Причина: ${reason}`,
      sentAt: now,
      payload: { orderId: order.id },
    });
    const updated = await tx
      .update(streamGifSubmissions)
      .set({
        status: "rejected",
        rejectionReason: reason,
        moderatedByAdminId: input.adminUserId,
        moderatedAt: now,
        updatedAt: now,
      })
      .where(eq(streamGifSubmissions.id, current.id))
      .returning();
    await storage.delete(current.stagingStorageKey);
    return {
      item: serialize(updated[0] ?? current, identity),
      replayed: false,
    };
  });
}

export async function dismissPlayingStreamGif(
  db: GiftbotDb,
  input: { adminUserId: string },
): Promise<{ donationId: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(streamDonations)
      .where(
        and(eq(streamDonations.status, "playing"), eq(streamDonations.kind, "gif")),
      )
      .limit(1)
      .for("update");
    const row = rows[0];
    if (!row) {
      throw new StreamGifNotPlayingError();
    }
    const now = new Date();
    await tx
      .update(streamDonations)
      .set({
        status: "finished",
        finishedAt: now,
        playbackOutcome: "dismissed",
      })
      .where(eq(streamDonations.id, row.id));
    await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "stream_gif.dismissed",
      targetType: "stream_donation",
      targetId: row.id,
      reason: "dismiss GIF from overlay",
      before: { status: "playing" },
      after: { status: "finished", playbackOutcome: "dismissed" },
    });
    return { donationId: row.id };
  });
}

export async function cleanupStaleStreamGifUploads(
  db: GiftbotDb,
  storage: StreamGifFileStorage,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - STREAM_GIF_STAGING_TTL_MS);
  const stale = await db
    .select()
    .from(streamGifSubmissions)
    .where(
      and(
        eq(streamGifSubmissions.status, "staging"),
        isNull(streamGifSubmissions.shopPurchaseId),
        lt(streamGifSubmissions.createdAt, cutoff),
      ),
    );
  for (const row of stale) {
    await storage.delete(row.stagingStorageKey);
    await db
      .delete(streamGifSubmissions)
      .where(eq(streamGifSubmissions.id, row.id));
  }
  await storage.cleanupStaging(now.getTime());
  return stale.length;
}
