import type { GiftbotDb } from "@giftbot/domain";
import { enqueueJob, type EnqueueJobResult } from "./enqueue.js";
import { JOB_TYPES } from "./types.js";

/**
 * Sweep cadence is an operational default, not a product SLA.
 */
export const TEMPORARY_UNCONFIRMED_RECONCILE_SWEEP_SECONDS = 60;

export function reconcileSweepIdempotencyKey(
  now = new Date(),
  windowSeconds = TEMPORARY_UNCONFIRMED_RECONCILE_SWEEP_SECONDS,
): string {
  const bucket = Math.floor(now.getTime() / 1000 / windowSeconds);
  return `wallet.reconcile:sweep:${bucket}`;
}

export async function enqueueReconcileSweep(
  db: GiftbotDb,
  now = new Date(),
): Promise<EnqueueJobResult> {
  return enqueueJob(db, {
    type: JOB_TYPES.walletReconcile,
    idempotencyKey: reconcileSweepIdempotencyKey(now),
    payload: {},
  });
}
