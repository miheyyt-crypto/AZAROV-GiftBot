import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  catalogStatus,
  openingStatus,
  purchaseStatus,
  referralEventType,
  referralStatus,
  stockMode,
  taskCompletionStatus,
} from "./enums.js";
import { users } from "./identity.js";
import { walletTransactions } from "./wallet.js";

export const referralCodes = pgTable(
  "referral_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    code: text("code").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("referral_codes_one_active_per_user")
      .on(table.userId)
      .where(sql`${table.isActive} = true`),
  ],
);

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerUserId: uuid("referrer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    refereeUserId: uuid("referee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    referralCodeUsed: text("referral_code_used").notNull(),
    status: referralStatus("status").notNull().default("attributed"),
    attributedAt: timestamp("attributed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
  },
  (table) => [
    uniqueIndex("referrals_referee_unique").on(table.refereeUserId),
    index("referrals_referrer_idx").on(table.referrerUserId),
    index("referrals_status_attributed_idx").on(table.status, table.attributedAt),
    check(
      "referrals_no_self_referral",
      sql`${table.referrerUserId} <> ${table.refereeUserId}`,
    ),
  ],
);

export const manualReferralCredits = pgTable(
  "manual_referral_credits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rewardTransactionId: uuid("reward_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    uniqueIndex("manual_referral_credits_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("manual_referral_credits_user_id_idx").on(table.userId),
    check("manual_referral_credits_amount_positive", sql`${table.amount} > 0`),
  ],
);

export const referralEvents = pgTable(
  "referral_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => referrals.id, { onDelete: "restrict" }),
    type: referralEventType("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("referral_events_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("referral_events_referral_id_idx").on(table.referralId),
  ],
);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: catalogStatus("status").notNull().default("draft"),
  rewardType: text("reward_type"),
  rewardMinor: bigint("reward_minor", { mode: "bigint" }),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const taskRequirements = pgTable(
  "task_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("task_requirements_task_id_idx").on(table.taskId)],
);

export const taskCompletions = pgTable(
  "task_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: taskCompletionStatus("status").notNull().default("started"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    rewardTransactionId: uuid("reward_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("task_completions_task_user_unique").on(
      table.taskId,
      table.userId,
    ),
    uniqueIndex("task_completions_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("task_completions_user_status_idx").on(table.userId, table.status),
    index("task_completions_task_status_idx").on(table.taskId, table.status),
  ],
);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull(),
  priceMinor: bigint("price_minor", { mode: "bigint" }),
  currencyCode: text("currency_code").notNull().default("INTERNAL"),
  stockMode: stockMode("stock_mode").notNull().default("unlimited"),
  stockRemaining: integer("stock_remaining"),
  status: catalogStatus("status").notNull().default("draft"),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    status: purchaseStatus("status").notNull().default("created"),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    walletTransactionId: uuid("wallet_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rejectionReason: text("rejection_reason"),
    submittedPayload: jsonb("submitted_payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    productCode: text("product_code"),
    productNameSnapshot: text("product_name_snapshot"),
    processingAt: timestamp("processing_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    processedByAdminId: uuid("processed_by_admin_id").references(
      () => users.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    uniqueIndex("purchases_idempotency_key_unique").on(table.idempotencyKey),
    index("purchases_user_id_idx").on(table.userId),
    index("purchases_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    index("purchases_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    index("purchases_product_code_created_idx").on(
      table.productCode,
      table.createdAt,
      table.id,
    ),
  ],
);

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  priceMinor: bigint("price_minor", { mode: "bigint" }),
  currencyCode: text("currency_code").notNull().default("INTERNAL"),
  status: catalogStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const caseRewardItems = pgTable(
  "case_reward_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    weight: integer("weight").notNull(),
    rewardMinor: bigint("reward_minor", { mode: "bigint" }),
  },
  (table) => [index("case_reward_items_case_id_idx").on(table.caseId)],
);

export const caseOpenings = pgTable(
  "case_openings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "restrict" }),
    status: openingStatus("status").notNull().default("created"),
    resultItemId: uuid("result_item_id").references(() => caseRewardItems.id, {
      onDelete: "restrict",
    }),
    debitTxId: uuid("debit_tx_id").references(() => walletTransactions.id, {
      onDelete: "restrict",
    }),
    prizeTxId: uuid("prize_tx_id").references(() => walletTransactions.id, {
      onDelete: "restrict",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("case_openings_idempotency_key_unique").on(table.idempotencyKey),
    index("case_openings_user_id_idx").on(table.userId),
  ],
);
