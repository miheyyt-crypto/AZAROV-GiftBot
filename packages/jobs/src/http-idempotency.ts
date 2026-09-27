import { idempotencyKeys } from "@giftbot/db/schema";
import type { GiftbotDb } from "@giftbot/domain";
import { and, eq } from "drizzle-orm";

export const HTTP_IDEMPOTENCY_TTL_STATUS = "TEMPORARY_UNCONFIRMED" as const;
export const TEMPORARY_UNCONFIRMED_HTTP_IDEMPOTENCY_TTL_SECONDS = 86_400;

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key was reused with a different request body");
    this.name = "IdempotencyConflictError";
  }
}

export type IdempotentHttpResult<T> = {
  status: number;
  body: T;
  replayed: boolean;
};

export async function runIdempotentPost<T>(
  db: GiftbotDb,
  input: {
    userId: string;
    route: string;
    key: string;
    requestHash: string;
    ttlSeconds?: number;
  },
  handler: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentHttpResult<T>> {
  const existingRows = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(eq(idempotencyKeys.userId, input.userId), eq(idempotencyKeys.key, input.key)),
    )
    .limit(1);
  const existing = existingRows[0];
  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      throw new IdempotencyConflictError();
    }
    return {
      status: existing.responseStatus ?? 200,
      body: existing.responseBodyRef
        ? (JSON.parse(existing.responseBodyRef) as T)
        : (undefined as T),
      replayed: true,
    };
  }

  const result = await handler();
  const ttlSeconds =
    input.ttlSeconds ?? TEMPORARY_UNCONFIRMED_HTTP_IDEMPOTENCY_TTL_SECONDS;
  const now = new Date();
  try {
    await db.insert(idempotencyKeys).values({
      key: input.key,
      userId: input.userId,
      route: input.route,
      requestHash: input.requestHash,
      responseStatus: result.status,
      responseBodyRef: JSON.stringify(result.body),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    });
  } catch {
    const raced = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(eq(idempotencyKeys.userId, input.userId), eq(idempotencyKeys.key, input.key)),
      )
      .limit(1);
    const row = raced[0];
    if (row && row.requestHash === input.requestHash) {
      return {
        status: row.responseStatus ?? result.status,
        body: row.responseBodyRef
          ? (JSON.parse(row.responseBodyRef) as T)
          : result.body,
        replayed: true,
      };
    }
    if (row) {
      throw new IdempotencyConflictError();
    }
    throw new Error("failed to persist idempotency key");
  }

  return { ...result, replayed: false };
}
