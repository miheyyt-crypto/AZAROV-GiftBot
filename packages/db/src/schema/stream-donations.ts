import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  streamDonationKind,
  streamDonationStatus,
  streamDonationTtsStatus,
  streamGifSubmissionStatus,
} from "./enums.js";
import { purchases } from "./growth.js";
import { users } from "./identity.js";
import { walletTransactions } from "./wallet.js";

export const streamDonations = pgTable(
  "stream_donations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).notNull(),
    displayName: text("display_name").notNull(),
    message: text("message").notNull(),
    amountAzc: bigint("amount_azc", { mode: "bigint" }).notNull(),
    status: streamDonationStatus("status").notNull().default("queued"),
    clientRequestId: text("client_request_id").notNull(),
    shopPurchaseId: uuid("shop_purchase_id").references(() => purchases.id, {
      onDelete: "restrict",
    }),
    walletTransactionId: uuid("wallet_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    overlaySessionId: uuid("overlay_session_id"),
    ttsStatus: streamDonationTtsStatus("tts_status").notNull().default("skipped"),
    ttsVoice: text("tts_voice"),
    ttsDurationMs: integer("tts_duration_ms"),
    ttsError: text("tts_error"),
    ttsGeneratedAt: timestamp("tts_generated_at", { withTimezone: true }),
    playingExpiresAt: timestamp("playing_expires_at", { withTimezone: true }),
    kind: streamDonationKind("kind").notNull().default("donation"),
    mediaStorageKey: text("media_storage_key"),
    mediaWidth: integer("media_width"),
    mediaHeight: integer("media_height"),
    mediaFrameCount: integer("media_frame_count"),
    playbackOutcome: text("playback_outcome"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("stream_donations_user_client_request_unique").on(
      table.userId,
      table.clientRequestId,
    ),
    uniqueIndex("stream_donations_shop_purchase_unique").on(table.shopPurchaseId),
    index("stream_donations_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    index("stream_donations_created_idx").on(table.createdAt),
    index("stream_donations_kind_status_idx").on(table.kind, table.status),
  ],
);

export const streamGifSubmissions = pgTable(
  "stream_gif_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    shopPurchaseId: uuid("shop_purchase_id").references(() => purchases.id, {
      onDelete: "restrict",
    }),
    streamDonationId: uuid("stream_donation_id").references(
      () => streamDonations.id,
      { onDelete: "restrict" },
    ),
    status: streamGifSubmissionStatus("status").notNull().default("staging"),
    stagingStorageKey: text("staging_storage_key").notNull(),
    acceptedStorageKey: text("accepted_storage_key"),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    frameCount: integer("frame_count").notNull(),
    rejectionReason: text("rejection_reason"),
    moderatedByAdminId: uuid("moderated_by_admin_id"),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stream_gif_submissions_purchase_unique").on(
      table.shopPurchaseId,
    ),
    uniqueIndex("stream_gif_submissions_donation_unique").on(
      table.streamDonationId,
    ),
    index("stream_gif_submissions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("stream_gif_submissions_status_idx").on(table.status),
  ],
);

export const streamAlertConsumers = pgTable("stream_alert_consumers", {
  id: integer("id").primaryKey(),
  sessionId: uuid("session_id").notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
});
