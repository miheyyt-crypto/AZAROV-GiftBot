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
import { walletTransactions } from "./wallet.js";

export const userAchievements = pgTable(
  "user_achievements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    achievementCode: text("achievement_code").notNull(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rewardAzc: bigint("reward_azc", { mode: "bigint" }).notNull(),
    progressSnapshot: jsonb("progress_snapshot"),
    rewardTransactionId: uuid("reward_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_achievements_user_code_unique").on(
      table.userId,
      table.achievementCode,
    ),
    index("user_achievements_user_unlocked_idx").on(
      table.userId,
      table.unlockedAt,
    ),
  ],
);
