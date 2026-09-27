import { kickAccounts } from "@giftbot/db/schema";
import type { GiftbotDb } from "@giftbot/domain";
import { and, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import { enqueueJob, type EnqueueJobResult } from "./enqueue.js";
import { JOB_TYPES } from "./types.js";

/**
 * How often the Worker idle loop looks for Kick tokens due for refresh.
 * Operational default — not a product SLA.
 */
export const KICK_REFRESH_SWEEP_SECONDS = 60;

/** Refresh when token_expires_at is within this many seconds (or already past). */
export const KICK_REFRESH_LEAD_SECONDS = 600;

/** Cap enqueues per sweep to avoid stampeding large link tables. */
export const KICK_REFRESH_SWEEP_BATCH = 50;

export function kickRefreshIdempotencyKey(
  kickAccountId: string,
  now = new Date(),
  windowSeconds = KICK_REFRESH_SWEEP_SECONDS,
): string {
  const bucket = Math.floor(now.getTime() / 1000 / windowSeconds);
  return `kick.refresh:${kickAccountId}:${bucket}`;
}

/**
 * Enqueue `kick.refresh_token` for active accounts whose access token is
 * missing an expiry or expires within the lead window.
 */
export async function enqueueDueKickTokenRefreshes(
  db: GiftbotDb,
  now = new Date(),
): Promise<EnqueueJobResult[]> {
  const leadDeadline = new Date(
    now.getTime() + KICK_REFRESH_LEAD_SECONDS * 1000,
  );
  const rows = await db
    .select({ id: kickAccounts.id })
    .from(kickAccounts)
    .where(
      and(
        eq(kickAccounts.status, "active"),
        isNotNull(kickAccounts.refreshTokenEncrypted),
        or(
          sql`${kickAccounts.tokenExpiresAt} is null`,
          lte(kickAccounts.tokenExpiresAt, leadDeadline),
        ),
      ),
    )
    .limit(KICK_REFRESH_SWEEP_BATCH);

  const results: EnqueueJobResult[] = [];
  for (const row of rows) {
    results.push(
      await enqueueJob(db, {
        type: JOB_TYPES.kickRefreshToken,
        idempotencyKey: kickRefreshIdempotencyKey(row.id, now),
        payload: { kick_account_id: row.id },
      }),
    );
  }
  return results;
}
