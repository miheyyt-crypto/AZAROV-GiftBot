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

export const paidCaseOpenings = pgTable(
  "paid_case_openings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    caseCode: text("case_code").notNull(),
    priceAzc: bigint("price_azc", { mode: "bigint" }).notNull(),
    itemCode: text("item_code").notNull(),
    titleSnapshot: text("title_snapshot").notNull(),
    rewardType: text("reward_type").notNull(),
    rewardSnapshot: jsonb("reward_snapshot").notNull().default({}),
    realWeight: bigint("real_weight", { mode: "bigint" }).notNull(),
    realChance: text("real_chance").notNull(),
    displayChance: text("display_chance"),
    rngDrawId: uuid("rng_draw_id").references(() => rngDraws.id, {
      onDelete: "restrict",
    }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    purchaseTransactionId: uuid("purchase_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    rewardTransactionId: uuid("reward_transaction_id").references(
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
    uniqueIndex("paid_case_openings_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("paid_case_openings_user_opened_idx").on(
      table.userId,
      table.openedAt,
      table.id,
    ),
    index("paid_case_openings_opened_idx").on(table.openedAt, table.id),
    index("paid_case_openings_case_opened_idx").on(
      table.caseCode,
      table.openedAt,
      table.id,
    ),
  ],
);
