import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userStatus } from "./enums.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: uuid("public_id").notNull().unique(),
    displayName: text("display_name"),
    locale: text("locale"),
    status: userStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("users_status_idx").on(table.status),
    index("users_created_at_idx").on(table.createdAt),
  ],
);

export const telegramAccounts = pgTable(
  "telegram_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" })
      .notNull()
      .unique(),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    languageCode: text("language_code"),
    isPremium: boolean("is_premium").notNull().default(false),
    photoUrl: text("photo_url"),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    index("telegram_accounts_user_id_idx").on(table.userId),
    index("telegram_accounts_username_idx").on(table.username),
    uniqueIndex("telegram_accounts_one_active_per_user")
      .on(table.userId)
      .where(sql`${table.isActive} = true`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
    authSource: text("auth_source").notNull().default("telegram_init_data"),
  },
  (table) => [
    index("sessions_user_revoked_expires_idx").on(
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
    index("sessions_expires_at_idx").on(table.expiresAt),
    uniqueIndex("sessions_one_unrevoked_per_user")
      .on(table.userId)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export const adminRoles = pgTable("admin_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const adminPermissions = pgTable("admin_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const adminRolePermissions = pgTable(
  "admin_role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => adminRoles.id, { onDelete: "restrict" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => adminPermissions.id, { onDelete: "restrict" }),
  },
  (table) => [uniqueIndex("admin_role_permissions_unique").on(table.roleId, table.permissionId)],
);

export const adminRoleAssignments = pgTable(
  "admin_role_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => adminRoles.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    assignedBy: uuid("assigned_by").references(() => users.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    uniqueIndex("admin_role_assignments_user_role").on(table.userId, table.roleId),
    index("admin_role_assignments_user_id_idx").on(table.userId),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
  },
  (table) => [
    index("admin_sessions_user_revoked_expires_idx").on(
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
    uniqueIndex("admin_sessions_one_unrevoked_per_user")
      .on(table.userId)
      .where(sql`${table.revokedAt} is null`),
  ],
);
