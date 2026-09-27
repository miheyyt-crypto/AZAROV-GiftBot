import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { actorType, walletStatus, walletTransactionType } from "./enums.js";
import { users } from "./identity.js";

export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    balanceMinor: bigint("balance_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    openingBalanceMinor: bigint("opening_balance_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    currencyCode: text("currency_code").notNull().default("INTERNAL"),
    version: bigint("version", { mode: "bigint" }).notNull().default(sql`0`),
    status: walletStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("wallets_user_id_unique").on(table.userId),
    index("wallets_balance_minor_desc_idx").on(table.balanceMinor),
    check("wallets_balance_non_negative", sql`${table.balanceMinor} >= 0`),
    check(
      "wallets_opening_balance_non_negative",
      sql`${table.openingBalanceMinor} >= 0`,
    ),
  ],
);

export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: walletTransactionType("type").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    balanceAfterMinor: bigint("balance_after_minor", { mode: "bigint" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    reversesTransactionId: uuid("reverses_transaction_id"),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    reason: text("reason"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("wallet_transactions_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("wallet_transactions_wallet_created_idx").on(
      table.walletId,
      table.createdAt,
    ),
    index("wallet_transactions_reference_idx").on(
      table.referenceType,
      table.referenceId,
    ),
    index("wallet_transactions_type_idx").on(table.type),
    check(
      "wallet_transactions_balance_after_non_negative",
      sql`${table.balanceAfterMinor} >= 0`,
    ),
  ],
);
