import { inboundEvents, jobs } from "@giftbot/db/schema";
import type { GiftbotDb, GiftbotTx } from "@giftbot/domain";
import { currentCorrelation } from "@giftbot/observability";
import { and, eq } from "drizzle-orm";
import {
  inboundIdempotencyKey,
  jobTypeForInbound,
  ownerForInbound,
  type InboundProvider,
} from "./types.js";

export type PersistInboundInput = {
  provider: InboundProvider;
  eventType: string;
  externalEventId: string;
  payload: unknown;
  signatureValid?: boolean;
  correlationId?: string;
};

export type PersistInboundResult = {
  created: boolean;
  eventId: string;
  jobId: string;
};

export async function persistInboundAndEnqueue(
  db: GiftbotDb,
  input: PersistInboundInput,
): Promise<PersistInboundResult> {
  const idempotencyKey = inboundIdempotencyKey(
    input.provider,
    input.externalEventId,
  );
  const jobType = jobTypeForInbound(input.provider);
  const owner = ownerForInbound(input.provider);
  const correlationId =
    input.correlationId ?? currentCorrelation()?.correlationId;

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(inboundEvents)
      .values({
        provider: input.provider,
        eventType: input.eventType,
        externalEventId: input.externalEventId,
        idempotencyKey,
        payload: input.payload,
        signatureValid: input.signatureValid ?? true,
        ...(correlationId ? { correlationId } : {}),
      })
      .onConflictDoNothing({
        target: [inboundEvents.provider, inboundEvents.externalEventId],
      })
      .returning();

    const event = inserted[0];
    if (!event) {
      const existingRows = await tx
        .select()
        .from(inboundEvents)
        .where(
          and(
            eq(inboundEvents.provider, input.provider),
            eq(inboundEvents.externalEventId, input.externalEventId),
          ),
        )
        .limit(1);
      const existing = existingRows[0];
      if (!existing) {
        throw new Error("inbound event conflict but row is missing");
      }
      if (existing.jobId) {
        return {
          created: false,
          eventId: existing.id,
          jobId: existing.jobId,
        };
      }
      const repaired = await ensureInboundJob(tx, {
        eventId: existing.id,
        jobType,
        owner,
        idempotencyKey,
        ...jobCorrelationFields(existing.correlationId ?? correlationId),
      });
      return { created: false, eventId: existing.id, jobId: repaired };
    }

    const jobId = await ensureInboundJob(tx, {
      eventId: event.id,
      jobType,
      owner,
      idempotencyKey,
      ...jobCorrelationFields(event.correlationId ?? correlationId),
    });
    return { created: true, eventId: event.id, jobId };
  });
}

function jobCorrelationFields(
  value: string | null | undefined,
): { correlationId: string } | Record<string, never> {
  return value ? { correlationId: value } : {};
}

async function ensureInboundJob(
  tx: GiftbotTx,
  input: {
    eventId: string;
    jobType: string;
    owner: "bot" | "worker";
    idempotencyKey: string;
    correlationId?: string | null;
  },
): Promise<string> {
  const inserted = await tx
    .insert(jobs)
    .values({
      type: input.jobType,
      owner: input.owner,
      payload: { inbound_event_id: input.eventId },
      idempotencyKey: input.idempotencyKey,
      inboundEventId: input.eventId,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    })
    .onConflictDoNothing({
      target: [jobs.type, jobs.idempotencyKey],
    })
    .returning({ id: jobs.id });

  const created = inserted[0];
  const jobId = created
    ? created.id
    : (
        await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.type, input.jobType),
              eq(jobs.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1)
      )[0]?.id;
  if (!jobId) {
    throw new Error("failed to enqueue inbound job");
  }

  await tx
    .update(inboundEvents)
    .set({ jobId })
    .where(eq(inboundEvents.id, input.eventId));
  return jobId;
}
