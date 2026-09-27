import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { promoCodeStatus } from "./enums.js";
import { users } from "./identity.js";

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    normalizedCode: text("normalized_code").notNull(),
    rewardAzc: bigint("reward_azc", { mode: "bigint" }).notNull(),
    activationLimit: integer("activation_limit").notNull(),
    activationCount: integer("activation_count").notNull().default(0),
    status: promoCodeStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("promo_codes_normalized_code_unique").on(table.normalizedCode),
    index("promo_codes_created_at_idx").on(table.createdAt, table.id),
    index("promo_codes_status_idx").on(table.status),
    check("promo_codes_reward_positive", sql`${table.rewardAzc} > 0`),
    check(
      "promo_codes_activation_limit_positive",
      sql`${table.activationLimit} > 0`,
    ),
    check(
      "promo_codes_activation_count_non_negative",
      sql`${table.activationCount} >= 0`,
    ),
    check(
      "promo_codes_activation_count_within_limit",
      sql`${table.activationCount} <= ${table.activationLimit}`,
    ),
  ],
);

export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promoCodeId: uuid("promo_code_id")
      .notNull()
      .references(() => promoCodes.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    rewardAzc: bigint("reward_azc", { mode: "bigint" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("promo_redemptions_promo_user_unique").on(
      table.promoCodeId,
      table.userId,
    ),
    index("promo_redemptions_user_idx").on(table.userId),
    index("promo_redemptions_promo_idx").on(table.promoCodeId),
    index("promo_redemptions_created_at_idx").on(table.createdAt, table.id),
    check("promo_redemptions_reward_positive", sql`${table.rewardAzc} > 0`),
  ],
);
