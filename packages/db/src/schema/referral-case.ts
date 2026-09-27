import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity.js";
import { inventoryItems } from "./profile.js";
import { rngDraws } from "./games.js";
import { walletTransactions } from "./wallet.js";

export const referralCaseEntitlements = pgTable(
  "referral_case_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    milestoneNumber: integer("milestone_number").notNull(),
    referralCountThreshold: integer("referral_count_threshold").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("referral_case_entitlements_user_milestone_unique").on(
      table.userId,
      table.milestoneNumber,
    ),
    index("referral_case_entitlements_user_available_idx")
      .on(table.userId, table.grantedAt)
      .where(sql`${table.consumedAt} is null`),
  ],
);

export const referralCaseOpenings = pgTable(
  "referral_case_openings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    caseCode: text("case_code").notNull().default("referral"),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => referralCaseEntitlements.id, { onDelete: "restrict" }),
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
    uniqueIndex("referral_case_openings_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("referral_case_openings_entitlement_unique").on(
      table.entitlementId,
    ),
    index("referral_case_openings_user_opened_idx").on(
      table.userId,
      table.openedAt,
      table.id,
    ),
    index("referral_case_openings_opened_idx").on(table.openedAt, table.id),
  ],
);
