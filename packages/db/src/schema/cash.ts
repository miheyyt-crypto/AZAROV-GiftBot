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
import { cashItemWithdrawalStatus } from "./enums.js";
import { users } from "./identity.js";
import { inventoryItems } from "./profile.js";

export const cashItemWithdrawals = pgTable(
  "cash_item_withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    amountRub: bigint("amount_rub", { mode: "bigint" }).notNull(),
    welvuraId: text("welvura_id").notNull(),
    status: cashItemWithdrawalStatus("status").notNull().default("pending"),
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
    uniqueIndex("cash_item_withdrawals_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("cash_item_withdrawals_one_active_per_item")
      .on(table.inventoryItemId)
      .where(sql`${table.status} in ('pending', 'processing')`),
    index("cash_item_withdrawals_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    index("cash_item_withdrawals_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    index("cash_item_withdrawals_item_created_idx").on(
      table.inventoryItemId,
      table.createdAt,
      table.id,
    ),
    check("cash_item_withdrawals_amount_positive", sql`${table.amountRub} > 0`),
  ],
);
