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
import { streamDonationStatus } from "./enums.js";
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
  ],
);

export const streamAlertConsumers = pgTable("stream_alert_consumers", {
  id: integer("id").primaryKey(),
  sessionId: uuid("session_id").notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
});
