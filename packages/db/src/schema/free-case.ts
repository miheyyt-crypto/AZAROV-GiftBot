import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { inventoryItems } from "./profile.js";
import { rngDraws } from "./games.js";
import { walletTransactions } from "./wallet.js";

export const freeCaseUserState = pgTable("free_case_user_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "restrict" }),
  nextAvailableAt: timestamp("next_available_at", { withTimezone: true })
    .notNull()
    .default(sql`'epoch'::timestamptz`),
  lastOpeningId: uuid("last_opening_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const freeCaseOpenings = pgTable(
  "free_case_openings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    caseCode: text("case_code").notNull().default("free"),
    itemCode: text("item_code").notNull(),
    titleSnapshot: text("title_snapshot").notNull(),
    rarity: text("rarity").notNull(),
    rewardType: text("reward_type").notNull(),
    rewardSnapshot: jsonb("reward_snapshot").notNull().default({}),
    realWeight: bigint("real_weight", { mode: "bigint" }).notNull(),
    displayChance: text("display_chance").notNull(),
    realChance: text("real_chance").notNull(),
    rngDrawId: uuid("rng_draw_id").references(() => rngDraws.id, {
      onDelete: "restrict",
    }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    nextAvailableAt: timestamp("next_available_at", {
      withTimezone: true,
    }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    walletTransactionId: uuid("wallet_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    inventoryItemId: uuid("inventory_item_id").references(
      () => inventoryItems.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("free_case_openings_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("free_case_openings_user_opened_idx").on(
      table.userId,
      table.openedAt,
      table.id,
    ),
    index("free_case_openings_opened_idx").on(table.openedAt, table.id),
  ],
);
