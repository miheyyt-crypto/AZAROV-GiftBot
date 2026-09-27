import { jobs } from "@giftbot/db/schema";
import type { GiftbotDb } from "@giftbot/domain";
import { currentCorrelation } from "@giftbot/observability";
import { and, eq } from "drizzle-orm";
import { ownerForJobType } from "./types.js";

export type EnqueueJobInput = {
  type: string;
  idempotencyKey: string;
  payload?: unknown;
  inboundEventId?: string;
  correlationId?: string;
  /** Durable delay — claim waits until this time. */
  nextAttemptAt?: Date;
  /** Higher values are claimed first. Default 0. */
  priority?: number;
};

export type EnqueueJobResult = {
  created: boolean;
  jobId: string;
};

export async function enqueueJob(
  db: GiftbotDb,
  input: EnqueueJobInput,
): Promise<EnqueueJobResult> {
  const owner = ownerForJobType(input.type);
  const correlationId =
    input.correlationId ?? currentCorrelation()?.correlationId;
  const inserted = await db
    .insert(jobs)
    .values({
      type: input.type,
      owner,
      payload: input.payload ?? {},
      idempotencyKey: input.idempotencyKey,
      ...(input.inboundEventId ? { inboundEventId: input.inboundEventId } : {}),
      ...(correlationId ? { correlationId } : {}),
      ...(input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    })
    .onConflictDoNothing({
      target: [jobs.type, jobs.idempotencyKey],
    })
    .returning({ id: jobs.id });

  const created = inserted[0];
  if (created) {
    return { created: true, jobId: created.id };
  }

  const existing = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(eq(jobs.type, input.type), eq(jobs.idempotencyKey, input.idempotencyKey)),
    )
    .limit(1);
  const row = existing[0];
  if (!row) {
    throw new Error("job conflict but row is missing");
  }
  return { created: false, jobId: row.id };
}
