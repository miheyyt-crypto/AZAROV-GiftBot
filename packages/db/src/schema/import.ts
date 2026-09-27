import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity.js";

export const v1ImportRuns = pgTable(
  "v1_import_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mode: text("mode").notNull(),
    dryRun: boolean("dry_run").notNull().default(false),
    sourceSha256: text("source_sha256").notNull(),
    usersRead: integer("users_read").notNull(),
    usersImported: integer("users_imported").notNull(),
    usersSkipped: integer("users_skipped").notNull(),
    usersConflicted: integer("users_conflicted").notNull(),
    reconcileOk: boolean("reconcile_ok").notNull(),
    report: jsonb("report").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("v1_import_runs_created_at_idx").on(table.createdAt)],
);

export const v1ImportIdentities = pgTable(
  "v1_import_identities",
  {
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    mode: text("mode").notNull(),
    importedBalanceMinor: bigint("imported_balance_minor", { mode: "bigint" })
      .notNull(),
    sourceLegacyId: text("source_legacy_id"),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => v1ImportRuns.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("v1_import_identities_user_id_idx").on(table.userId)],
);
