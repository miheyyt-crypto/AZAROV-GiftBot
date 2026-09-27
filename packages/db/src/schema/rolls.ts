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
import { walletTransactions } from "./wallet.js";

export const rollsRounds = pgTable(
  "rolls_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").notNull(),
    version: bigint("version", { mode: "bigint" }).notNull().default(1n),
    participantCount: integer("participant_count").notNull().default(0),
    totalPot: bigint("total_pot", { mode: "bigint" }).notNull().default(0n),
    bettingStartedAt: timestamp("betting_started_at", { withTimezone: true }),
    bettingDeadline: timestamp("betting_deadline", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    spinStartedAt: timestamp("spin_started_at", { withTimezone: true }),
    spinDurationMs: integer("spin_duration_ms").notNull().default(8_000),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    nonce: bigint("nonce", { mode: "bigint" }).notNull(),
    algorithm: text("algorithm").notNull().default("azarov:v1:rolls"),
    aggregateClientSeed: text("aggregate_client_seed"),
    participantSnapshotHash: text("participant_snapshot_hash"),
    participantSnapshot: jsonb("participant_snapshot"),
    winningTicket: bigint("winning_ticket", { mode: "bigint" }),
    winnerUserId: uuid("winner_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    winnerParticipantId: uuid("winner_participant_id"),
    payoutAzc: bigint("payout_azc", { mode: "bigint" }),
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
  },
  (table) => [
    uniqueIndex("rolls_rounds_one_current")
      .on(sql`true`)
      .where(sql`${table.status} IN ('waiting', 'betting', 'spinning')`),
    index("rolls_rounds_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const rollsParticipants = pgTable(
  "rolls_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rollsRounds.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publicId: text("public_id").notNull(),
    displayName: text("display_name").notNull(),
    avatarKey: text("avatar_key"),
    totalStake: bigint("total_stake", { mode: "bigint" }).notNull(),
    clientSeed: text("client_seed").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("rolls_participants_round_user_unique").on(
      table.roundId,
      table.userId,
    ),
    index("rolls_participants_round_joined_idx").on(
      table.roundId,
      table.joinedAt,
      table.id,
    ),
  ],
);

export const rollsBetOperations = pgTable(
  "rolls_bet_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rollsRounds.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => rollsParticipants.id, { onDelete: "restrict" }),
    amountAzc: bigint("amount_azc", { mode: "bigint" }).notNull(),
    stakeAfter: bigint("stake_after", { mode: "bigint" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    betTransactionId: uuid("bet_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("rolls_bet_operations_user_key_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("rolls_bet_operations_round_created_idx").on(
      table.roundId,
      table.createdAt,
    ),
  ],
);
