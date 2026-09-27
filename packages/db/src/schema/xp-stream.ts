import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity.js";
import { inboundEvents } from "./ops.js";
import { inventoryItems } from "./profile.js";
import { walletTransactions } from "./wallet.js";

export const kickStreamSessions = pgTable(
  "kick_stream_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: text("channel").notNull(),
    providerStreamId: text("provider_stream_id"),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    finalizationStatus: text("finalization_status").notNull().default("none"),
    finalizationCursorUserId: uuid("finalization_cursor_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("kick_stream_sessions_one_live_per_channel")
      .on(table.channel)
      .where(sql`${table.status} = 'live'`),
    uniqueIndex("kick_stream_sessions_provider_stream_unique")
      .on(table.providerStreamId)
      .where(sql`${table.providerStreamId} IS NOT NULL`),
    index("kick_stream_sessions_channel_started_idx").on(
      table.channel,
      table.startedAt,
    ),
  ],
);

export const kickChatMessageApplications = pgTable(
  "kick_chat_message_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerMessageId: text("provider_message_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    streamSessionId: uuid("stream_session_id")
      .notNull()
      .references(() => kickStreamSessions.id, { onDelete: "restrict" }),
    inboundEventId: uuid("inbound_event_id").references(() => inboundEvents.id, {
      onDelete: "set null",
    }),
    xpAwarded: integer("xp_awarded").notNull().default(1),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("kick_chat_message_applications_provider_unique").on(
      table.providerMessageId,
    ),
    index("kick_chat_message_applications_user_applied_idx").on(
      table.userId,
      table.appliedAt,
    ),
  ],
);

export const userStreamParticipation = pgTable(
  "user_stream_participation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    streamSessionId: uuid("stream_session_id")
      .notNull()
      .references(() => kickStreamSessions.id, { onDelete: "restrict" }),
    messageCount: integer("message_count").notNull().default(0),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    streakAction: text("streak_action"),
    rewardAzc: bigint("reward_azc", { mode: "bigint" }),
    freezeInventoryItemId: uuid("freeze_inventory_item_id").references(
      () => inventoryItems.id,
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
    uniqueIndex("user_stream_participation_user_stream_unique").on(
      table.userId,
      table.streamSessionId,
    ),
    index("user_stream_participation_stream_idx").on(table.streamSessionId),
  ],
);

export const userStreamStreaks = pgTable("user_stream_streaks", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "restrict" }),
  currentStreak: integer("current_streak").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastQualifiedStreamId: uuid("last_qualified_stream_id").references(
    () => kickStreamSessions.id,
    { onDelete: "restrict" },
  ),
  lastFinalizedStreamId: uuid("last_finalized_stream_id").references(
    () => kickStreamSessions.id,
    { onDelete: "restrict" },
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userLevelRewards = pgTable(
  "user_level_rewards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reachedLevel: integer("reached_level").notNull(),
    rewardAzc: bigint("reward_azc", { mode: "bigint" }).notNull(),
    rewardTransactionId: uuid("reward_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_level_rewards_user_level_unique").on(
      table.userId,
      table.reachedLevel,
    ),
  ],
);
