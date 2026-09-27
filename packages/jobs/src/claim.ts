import { jobs } from "@giftbot/db/schema";
import type { GiftbotDb } from "@giftbot/domain";
import { eq, sql } from "drizzle-orm";
import { computeBackoffMs, JOB_RETRY } from "./retry.js";

export type ClaimedJob = {
  id: string;
  type: string;
  owner: "bot" | "worker";
  payload: unknown;
  idempotencyKey: string;
  inboundEventId: string | null;
  correlationId: string | null;
  retryCount: number;
  maxAttempts: number;
};

function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) {
    const row = result[0];
    return row && typeof row === "object"
      ? (row as Record<string, unknown>)
      : undefined;
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown[] }).rows;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    return row && typeof row === "object"
      ? (row as Record<string, unknown>)
      : undefined;
  }
  return undefined;
}

function asClaimedJob(row: Record<string, unknown>): ClaimedJob {
  const inbound = row.inboundEventId ?? row.inbound_event_id ?? null;
  const correlation = row.correlationId ?? row.correlation_id ?? null;
  return {
    id: String(row.id),
    type: String(row.type),
    owner: row.owner === "worker" ? "worker" : "bot",
    payload: row.payload,
    idempotencyKey: String(row.idempotencyKey ?? row.idempotency_key),
    inboundEventId: inbound === null ? null : String(inbound),
    correlationId: correlation === null ? null : String(correlation),
    retryCount: Number(row.retryCount ?? row.retry_count ?? 0),
    maxAttempts: Number(row.maxAttempts ?? row.max_attempts ?? 8),
  };
}

export async function claimNextJob(
  db: GiftbotDb,
  input: {
    owner: "bot" | "worker";
    lockedBy: string;
    staleLockMs?: number;
  },
): Promise<ClaimedJob | undefined> {
  const staleLockMs = input.staleLockMs ?? JOB_RETRY.staleLockMs;
  const result = await db.execute(sql`
    update jobs
    set
      status = 'processing',
      locked_at = now(),
      locked_by = ${input.lockedBy},
      updated_at = now()
    where id = (
      select id
      from jobs
      where owner = ${input.owner}::job_owner
        and (
          (
            status in ('pending', 'failed')
            and next_attempt_at <= now()
          )
          or (
            status = 'processing'
            and locked_at is not null
            and locked_at <= now() - (${staleLockMs} * interval '1 millisecond')
          )
        )
      order by priority desc, created_at
      for update skip locked
      limit 1
    )
    returning
      id,
      type,
      owner,
      payload,
      idempotency_key as "idempotencyKey",
      inbound_event_id as "inboundEventId",
      correlation_id as "correlationId",
      retry_count as "retryCount",
      max_attempts as "maxAttempts"
  `);

  const row = firstRow(result);
  return row ? asClaimedJob(row) : undefined;
}

export async function completeJob(db: GiftbotDb, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "completed",
      lockedAt: null,
      lockedBy: null,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

export async function failJob(
  db: GiftbotDb,
  jobId: string,
  error: string,
  retryCount: number,
  maxAttempts: number,
  options?: { delayMs?: number; permanent?: boolean },
): Promise<"pending" | "dead"> {
  const nextRetry = retryCount + 1;
  const dead = options?.permanent === true || nextRetry >= maxAttempts;
  const delayMs = options?.delayMs ?? computeBackoffMs(retryCount);
  await db
    .update(jobs)
    .set({
      status: dead ? "dead" : "pending",
      retryCount: dead && options?.permanent === true ? retryCount : nextRetry,
      nextAttemptAt: new Date(Date.now() + (dead ? 0 : delayMs)),
      lockedAt: null,
      lockedBy: null,
      error,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
  return dead ? "dead" : "pending";
}
