import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { catalogStatus, kickAccountStatus } from "./enums.js";
import { users } from "./identity.js";
import { inboundEvents } from "./ops.js";

export const partners = pgTable("partners", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  status: catalogStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const partnerActions = pgTable(
  "partner_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("partner_actions_user_id_idx").on(table.userId),
    index("partner_actions_partner_id_idx").on(table.partnerId),
  ],
);

export const kickAccounts = pgTable(
  "kick_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kickUserId: text("kick_user_id").notNull().unique(),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    scope: text("scope"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    status: kickAccountStatus("status").notNull().default("active"),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    lastInboundEventId: uuid("last_inbound_event_id").references(
      () => inboundEvents.id,
      { onDelete: "restrict" },
    ),
    username: text("username"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
  },
  (table) => [
    index("kick_accounts_user_id_idx").on(table.userId),
    uniqueIndex("kick_accounts_one_active_per_user")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const kickOauthStates = pgTable("kick_oauth_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  state: text("state").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  codeChallenge: text("code_challenge"),
  codeVerifier: text("code_verifier"),
  redirectPurpose: text("redirect_purpose"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const kickWebhookSubscriptions = pgTable("kick_webhook_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  kickAccountId: uuid("kick_account_id")
    .notNull()
    .references(() => kickAccounts.id, { onDelete: "restrict" }),
  externalId: text("external_id"),
  topic: text("topic").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
