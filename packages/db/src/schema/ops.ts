import { sql } from "drizzle-orm";
import {
  boolean,
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
  actorType,
  inboundProcessingStatus,
  inboundProvider,
  jobOwner,
  jobStatus,
  notificationChannel,
  notificationStatus,
} from "./enums.js";
import { users } from "./identity.js";

export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: inboundProvider("provider").notNull(),
    eventType: text("event_type").notNull(),
    externalEventId: text("external_event_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingStatus: inboundProcessingStatus("processing_status")
      .notNull()
      .default("queued"),
    lastError: text("last_error"),
    jobId: uuid("job_id"),
    correlationId: text("correlation_id"),
  },
  (table) => [
    uniqueIndex("inbound_events_provider_external_id_unique").on(
      table.provider,
      table.externalEventId,
    ),
    uniqueIndex("inbound_events_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("inbound_events_status_received_idx").on(
      table.processingStatus,
      table.receivedAt,
    ),
    index("inbound_events_job_id_idx").on(table.jobId),
    index("inbound_events_correlation_id_idx").on(table.correlationId),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    owner: jobOwner("owner").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: jobStatus("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    retryCount: integer("retry_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    priority: integer("priority").notNull().default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    error: text("error"),
    resultRef: text("result_ref"),
    inboundEventId: uuid("inbound_event_id").references(() => inboundEvents.id, {
      onDelete: "restrict",
    }),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("jobs_type_idempotency_key_unique").on(
      table.type,
      table.idempotencyKey,
    ),
    index("jobs_claim_idx").on(table.owner, table.status, table.nextAttemptAt),
    index("jobs_claim_priority_idx").on(
      table.owner,
      table.status,
      table.priority,
      table.nextAttemptAt,
      table.createdAt,
    ),
    index("jobs_created_at_idx").on(table.createdAt),
    index("jobs_correlation_id_idx").on(table.correlationId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    channel: notificationChannel("channel").notNull(),
    type: text("type").notNull(),
    status: notificationStatus("status").notNull().default("pending"),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    title: text("title"),
    body: text("body"),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    index("notifications_user_status_idx").on(table.userId, table.status),
    index("notifications_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    requestId: text("request_id"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_actor_idx").on(table.actorType, table.actorId),
    index("audit_logs_target_idx").on(table.targetType, table.targetId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    route: text("route").notNull(),
    requestHash: text("request_hash"),
    responseStatus: integer("response_status"),
    responseBodyRef: text("response_body_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_user_key_unique").on(table.userId, table.key),
    index("idempotency_keys_expires_at_idx").on(table.expiresAt),
  ],
);

export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
