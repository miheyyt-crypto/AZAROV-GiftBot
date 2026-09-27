import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { gramWithdrawalStatus } from "./enums.js";
import { users } from "./identity.js";

export const gramWithdrawals = pgTable(
  "gram_withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    telegramUsername: text("telegram_username").notNull(),
    status: gramWithdrawalStatus("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processingAt: timestamp("processing_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    processedByAdminId: uuid("processed_by_admin_id").references(
      () => users.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    uniqueIndex("gram_withdrawals_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("gram_withdrawals_one_active_per_user")
      .on(table.userId)
      .where(sql`${table.status} in ('pending', 'processing')`),
    index("gram_withdrawals_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    index("gram_withdrawals_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    check("gram_withdrawals_amount_positive", sql`${table.amountMinor} > 0`),
  ],
);
