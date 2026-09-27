import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity.js";
import { walletTransactions } from "./wallet.js";

export const provablyFairNonces = pgTable(
  "provably_fair_nonces",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    game: text("game").notNull(),
    nextNonce: bigint("next_nonce", { mode: "bigint" }).notNull().default(0n),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.game] })],
);

export const minesGames = pgTable(
  "mines_games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    betAzc: bigint("bet_azc", { mode: "bigint" }).notNull(),
    mineCount: integer("mine_count").notNull(),
    minePositions: integer("mine_positions").array().notNull(),
    revealedCells: integer("revealed_cells").array().notNull().default([]),
    safePickCount: integer("safe_pick_count").notNull().default(0),
    currentMultiplier: text("current_multiplier"),
    payoutAzc: bigint("payout_azc", { mode: "bigint" }),
    clientSeed: text("client_seed").notNull(),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    nonce: bigint("nonce", { mode: "bigint" }).notNull(),
    algorithm: text("algorithm").notNull().default("azarov:v1:mines"),
    startIdempotencyKey: text("start_idempotency_key").notNull(),
    betTransactionId: uuid("bet_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    winTransactionId: uuid("win_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("mines_games_one_active_per_user")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("mines_games_start_idempotency_unique").on(
      table.userId,
      table.startIdempotencyKey,
    ),
    index("mines_games_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const diceRounds = pgTable(
  "dice_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    betAzc: bigint("bet_azc", { mode: "bigint" }).notNull(),
    chance: integer("chance").notNull(),
    rawResult: integer("raw_result").notNull(),
    win: boolean("win").notNull(),
    payoutAzc: bigint("payout_azc", { mode: "bigint" }).notNull(),
    clientSeed: text("client_seed").notNull(),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    nonce: bigint("nonce", { mode: "bigint" }).notNull(),
    algorithm: text("algorithm").notNull().default("azarov:v1:dice"),
    playIdempotencyKey: text("play_idempotency_key").notNull(),
    betTransactionId: uuid("bet_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    winTransactionId: uuid("win_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("dice_rounds_play_idempotency_unique").on(
      table.userId,
      table.playIdempotencyKey,
    ),
    index("dice_rounds_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
  ],
);
