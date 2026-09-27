import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  inventoryItemStatus,
  inventoryItemType,
  welvuraLinkStatus,
} from "./enums.js";
import { users } from "./identity.js";

export const gramBalances = pgTable(
  "gram_balances",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    reservedMinor: bigint("reserved_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("gram_balances_amount_non_negative", sql`${table.amountMinor} >= 0`),
    check(
      "gram_balances_reserved_non_negative",
      sql`${table.reservedMinor} >= 0`,
    ),
    check(
      "gram_balances_reserved_lte_balance",
      sql`${table.reservedMinor} <= ${table.amountMinor}`,
    ),
  ],
);

export const userProgress = pgTable(
  "user_progress",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    totalXp: bigint("total_xp", { mode: "bigint" }).notNull().default(sql`0`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("user_progress_xp_non_negative", sql`${table.totalXp} >= 0`)],
);

export const userKickStats = pgTable(
  "user_kick_stats",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    chatMessagesCounted: bigint("chat_messages_counted", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "user_kick_stats_messages_non_negative",
      sql`${table.chatMessagesCounted} >= 0`,
    ),
  ],
);

export const welvuraLinks = pgTable("welvura_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "restrict" }),
  welvuraExternalId: text("welvura_external_id"),
  status: welvuraLinkStatus("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    itemType: inventoryItemType("item_type").notNull(),
    status: inventoryItemStatus("status").notNull().default("available"),
    quantity: integer("quantity").notNull().default(1),
    amountRub: bigint("amount_rub", { mode: "bigint" }),
    source: text("source"),
    itemCode: text("item_code"),
    title: text("title"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("inventory_items_user_type_status_idx").on(
      table.userId,
      table.itemType,
      table.status,
    ),
    index("inventory_items_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    check("inventory_items_quantity_positive", sql`${table.quantity} >= 0`),
    check(
      "inventory_items_cash_amount",
      sql`(
        (${table.itemType} = 'cash_rub' AND ${table.amountRub} IS NOT NULL AND ${table.amountRub} >= 0)
        OR (${table.itemType} = 'streak_freeze' AND ${table.amountRub} IS NULL)
        OR (${table.itemType}::text = 'external_prize' AND ${table.amountRub} IS NULL)
      )`,
    ),
  ],
);
