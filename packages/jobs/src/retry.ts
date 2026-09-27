/**
 * Job retry / lock defaults. TEMPORARY_UNCONFIRMED operational values,
 * not product TTLs or economy numbers.
 */
export const JOB_RETRY = {
  status: "TEMPORARY_UNCONFIRMED",
  baseDelayMs: 1_000,
  maxDelayMs: 300_000,
  staleLockMs: 60_000,
  jitterRatio: 0.2,
} as const;

export function computeBackoffMs(
  retryCount: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(
    JOB_RETRY.maxDelayMs,
    JOB_RETRY.baseDelayMs * 2 ** Math.max(0, retryCount),
  );
  const jitter = Math.floor(exp * JOB_RETRY.jitterRatio * random());
  return exp + jitter;
}
