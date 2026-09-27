import { sql } from "drizzle-orm";
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
import {
  catalogStatus,
  gameRoundStatus,
  gameSettlementMode,
  giveawayEntryStatus,
  giveawayStatus,
  rngPurpose,
} from "./enums.js";
import { users } from "./identity.js";
import { walletTransactions } from "./wallet.js";

export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  settlementMode: gameSettlementMode("settlement_mode").notNull(),
  status: catalogStatus("status").notNull().default("draft"),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const gameRounds = pgTable(
  "game_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: gameRoundStatus("status").notNull().default("created"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("game_rounds_idempotency_key_unique").on(table.idempotencyKey),
    index("game_rounds_user_id_idx").on(table.userId),
    index("game_rounds_status_idx").on(table.status),
  ],
);

export const gameBets = pgTable(
  "game_bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => gameRounds.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    walletTxId: uuid("wallet_tx_id").references(() => walletTransactions.id, {
      onDelete: "restrict",
    }),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("game_bets_round_id_unique").on(table.roundId)],
);

export const rngDraws = pgTable(
  "rng_draws",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: rngPurpose("purpose").notNull(),
    algorithm: text("algorithm").notNull(),
    entropySource: text("entropy_source").notNull(),
    resultInt: bigint("result_int", { mode: "bigint" }),
    hash: text("hash").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("rng_draws_reference_idx").on(table.referenceType, table.referenceId),
  ],
);

export const gameResults = pgTable(
  "game_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => gameRounds.id, { onDelete: "restrict" }),
    rngDrawId: uuid("rng_draw_id").references(() => rngDraws.id, {
      onDelete: "restrict",
    }),
    resultPayload: jsonb("result_payload").notNull(),
    prizeTxId: uuid("prize_tx_id").references(() => walletTransactions.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("game_results_round_id_unique").on(table.roundId)],
);

export const giveaways = pgTable(
  "giveaways",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    status: giveawayStatus("status").notNull().default("draft"),
    type: text("type").notNull(),
    bankAzc: bigint("bank_azc", { mode: "bigint" }),
    customPrize: text("custom_prize"),
    winnerCount: integer("winner_count").notNull(),
    actualWinnerCount: integer("actual_winner_count"),
    eligibility: text("eligibility").notNull().default("linked_kick"),
    prizePerWinnerAzc: bigint("prize_per_winner_azc", { mode: "bigint" }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    drawnAt: timestamp("drawn_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    imageUrl: text("image_url"),
    version: bigint("version", { mode: "bigint" }).notNull().default(1n),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("giveaways_status_ends_idx").on(table.status, table.endsAt)],
);

export const giveawayEntries = pgTable(
  "giveaway_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    giveawayId: uuid("giveaway_id")
      .notNull()
      .references(() => giveaways.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: giveawayEntryStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("giveaway_entries_giveaway_user_unique").on(
      table.giveawayId,
      table.userId,
    ),
  ],
);

export const giveawayWinners = pgTable(
  "giveaway_winners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    giveawayId: uuid("giveaway_id")
      .notNull()
      .references(() => giveaways.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => giveawayEntries.id, { onDelete: "restrict" }),
    rngDrawId: uuid("rng_draw_id").references(() => rngDraws.id, {
      onDelete: "restrict",
    }),
    prizeAzc: bigint("prize_azc", { mode: "bigint" }),
    prizeText: text("prize_text"),
    deliveryStatus: text("delivery_status"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveredBy: uuid("delivered_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    rewardTransactionId: uuid("reward_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    selectedAt: timestamp("selected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("giveaway_winners_giveaway_id_idx").on(table.giveawayId),
    uniqueIndex("giveaway_winners_giveaway_user_unique").on(
      table.giveawayId,
      table.userId,
    ),
    uniqueIndex("giveaway_winners_giveaway_entry_unique").on(
      table.giveawayId,
      table.entryId,
    ),
  ],
);
