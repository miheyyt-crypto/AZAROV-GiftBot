import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  telegramBroadcastRecipientStatus,
  telegramBroadcastStatus,
} from "./enums.js";
import { users } from "./identity.js";

export const telegramBroadcasts = pgTable(
  "telegram_broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: telegramBroadcastStatus("status").notNull().default("queued"),
    messageText: text("message_text").notNull(),
    photoKey: text("photo_key"),
    parseMode: text("parse_mode").notNull().default("HTML"),
    button: jsonb("button"),
    recipientCount: integer("recipient_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("telegram_broadcasts_created_at_idx").on(table.createdAt),
    index("telegram_broadcasts_status_idx").on(table.status),
  ],
);

export const telegramBroadcastRecipients = pgTable(
  "telegram_broadcast_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => telegramBroadcasts.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).notNull(),
    expectedJobs: smallint("expected_jobs").notNull().default(1),
    completedJobs: smallint("completed_jobs").notNull().default(0),
    status: telegramBroadcastRecipientStatus("status")
      .notNull()
      .default("pending"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("telegram_broadcast_recipients_unique").on(
      table.broadcastId,
      table.telegramUserId,
    ),
    index("telegram_broadcast_recipients_broadcast_status_idx").on(
      table.broadcastId,
      table.status,
    ),
  ],
);
