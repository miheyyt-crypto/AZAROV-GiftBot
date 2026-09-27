import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";
export const CORRELATION_ID_HEADER = "x-correlation-id";

export type CorrelationIds = {
  requestId: string;
  correlationId: string;
  eventId?: string;
  jobId?: string;
};

const storage = new AsyncLocalStorage<CorrelationIds>();

const INCOMING_ID = /^[\w.-]{1,128}$/;

export function sanitizeCorrelationId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !INCOMING_ID.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function createCorrelationIds(input: {
  requestId?: string;
  correlationId?: string;
  eventId?: string;
  jobId?: string;
} = {}): CorrelationIds {
  const requestId = sanitizeCorrelationId(input.requestId) ?? randomUUID();
  const correlationId =
    sanitizeCorrelationId(input.correlationId) ?? requestId;
  return {
    requestId,
    correlationId,
    ...(input.eventId ? { eventId: input.eventId } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
  };
}

export function currentCorrelation(): CorrelationIds | undefined {
  return storage.getStore();
}

export function runWithCorrelation<T>(
  ids: CorrelationIds,
  fn: () => T,
): T {
  return storage.run(ids, fn);
}

export function correlationLogFields(
  ids = currentCorrelation(),
): Record<string, string> {
  if (!ids) {
    return {};
  }
  return {
    request_id: ids.requestId,
    correlation_id: ids.correlationId,
    ...(ids.eventId ? { event_id: ids.eventId } : {}),
    ...(ids.jobId ? { job_id: ids.jobId } : {}),
  };
}

export function correlationMetadata(
  ids = currentCorrelation(),
): Record<string, string> {
  return correlationLogFields(ids);
}

export function jobCorrelation(job: {
  id: string;
  correlationId?: string | null;
  inboundEventId?: string | null;
}): CorrelationIds {
  return createCorrelationIds({
    ...(job.correlationId ? { requestId: job.correlationId } : {}),
    ...(job.correlationId ? { correlationId: job.correlationId } : {}),
    jobId: job.id,
    ...(job.inboundEventId ? { eventId: job.inboundEventId } : {}),
  });
}
