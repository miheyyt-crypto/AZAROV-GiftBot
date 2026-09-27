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

export const userTaskEvidence = pgTable("user_task_evidence", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "restrict" }),
  botStartedAt: timestamp("bot_started_at", { withTimezone: true }),
  telegramChannelMemberAt: timestamp("telegram_channel_member_at", {
    withTimezone: true,
  }),
  kickFollowAzarovAt: timestamp("kick_follow_azarov_at", { withTimezone: true }),
  kickNicknameSnapshot: text("kick_nickname_snapshot"),
  kickNicknameCheckedAt: timestamp("kick_nickname_checked_at", {
    withTimezone: true,
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userTaskCompletions = pgTable(
  "user_task_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    taskCode: text("task_code").notNull(),
    rewardAzc: bigint("reward_azc", { mode: "bigint" }).notNull(),
    verificationSnapshot: jsonb("verification_snapshot")
      .notNull()
      .default({}),
    rewardTransactionId: uuid("reward_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_task_completions_user_task_unique").on(
      table.userId,
      table.taskCode,
    ),
    index("user_task_completions_user_completed_idx").on(
      table.userId,
      table.completedAt,
    ),
  ],
);

export const submissionFiles = pgTable("submission_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  storageKey: text("storage_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  originalFilename: text("original_filename"),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const welvuraAccountSubmissions = pgTable(
  "welvura_account_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    welvuraExternalId: text("welvura_external_id").notNull(),
    screenshotFileId: uuid("screenshot_file_id")
      .notNull()
      .references(() => submissionFiles.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderatedByAdminId: uuid("moderated_by_admin_id").references(
      () => users.id,
      { onDelete: "restrict" },
    ),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("welvura_account_submissions_user_attempt_unique").on(
      table.userId,
      table.attemptNumber,
    ),
    uniqueIndex("welvura_account_submissions_one_pending_per_user")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    index("welvura_account_submissions_status_submitted_idx").on(
      table.status,
      table.submittedAt,
    ),
  ],
);

export const welvuraDepositSubmissions = pgTable(
  "welvura_deposit_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    stageNumber: integer("stage_number").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    welvuraExternalId: text("welvura_external_id").notNull(),
    requiredDepositRub: bigint("required_deposit_rub", { mode: "bigint" }).notNull(),
    rewardAzc: bigint("reward_azc", { mode: "bigint" }).notNull(),
    screenshotFileId: uuid("screenshot_file_id")
      .notNull()
      .references(() => submissionFiles.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderatedByAdminId: uuid("moderated_by_admin_id").references(
      () => users.id,
      { onDelete: "restrict" },
    ),
    rejectionReason: text("rejection_reason"),
    rewardTransactionId: uuid("reward_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("welvura_deposit_submissions_user_stage_attempt_unique").on(
      table.userId,
      table.stageNumber,
      table.attemptNumber,
    ),
    uniqueIndex("welvura_deposit_submissions_one_pending_per_stage")
      .on(table.userId, table.stageNumber)
      .where(sql`${table.status} = 'pending'`),
    index("welvura_deposit_submissions_status_submitted_idx").on(
      table.status,
      table.submittedAt,
    ),
  ],
);

export const welvuraStageCompletions = pgTable(
  "welvura_stage_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    stageNumber: integer("stage_number").notNull(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => welvuraDepositSubmissions.id, { onDelete: "restrict" }),
    rewardAzc: bigint("reward_azc", { mode: "bigint" }).notNull(),
    rewardTransactionId: uuid("reward_transaction_id").references(
      () => walletTransactions.id,
      { onDelete: "restrict" },
    ),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("welvura_stage_completions_user_stage_unique").on(
      table.userId,
      table.stageNumber,
    ),
    uniqueIndex("welvura_stage_completions_submission_unique").on(
      table.submissionId,
    ),
  ],
);
