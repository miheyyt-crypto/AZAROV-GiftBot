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
import { referralContestStatus } from "./enums.js";
import { users } from "./identity.js";
import { walletTransactions } from "./wallet.js";

export const referralContests = pgTable(
  "referral_contests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: referralContestStatus("status").notNull(),
    title: text("title").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    prizePoolAzc: bigint("prize_pool_azc", { mode: "bigint" }).notNull(),
    prizeDistribution: jsonb("prize_distribution").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("referral_contests_one_open")
      .on(sql`(1)`)
      .where(sql`${table.finalizedAt} is null`),
    index("referral_contests_status_end_idx").on(table.status, table.endAt),
  ],
);

export const referralContestResults = pgTable(
  "referral_contest_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => referralContests.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    place: integer("place").notNull(),
    referralCount: integer("referral_count").notNull(),
    scoreReachedAt: timestamp("score_reached_at", { withTimezone: true }).notNull(),
    rewardAzc: bigint("reward_azc", { mode: "bigint" }).notNull().default(0n),
    rewardTransactionId: uuid("reward_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("referral_contest_results_contest_user_unique").on(
      table.contestId,
      table.userId,
    ),
    uniqueIndex("referral_contest_results_contest_place_unique").on(
      table.contestId,
      table.place,
    ),
    index("referral_contest_results_contest_place_idx").on(
      table.contestId,
      table.place,
    ),
  ],
);
