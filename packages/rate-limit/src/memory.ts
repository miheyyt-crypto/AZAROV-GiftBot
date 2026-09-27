import type { RateLimitDecision, RateLimiter } from "./port.js";

export type MemoryRateLimiterOptions = {
  windowSeconds: number;
  maxRequests: number;
};

type Bucket = {
  count: number;
  resetAtMs: number;
};

export function createMemoryRateLimiter(
  options: MemoryRateLimiterOptions,
): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function sweep(nowMs: number): void {
    if (buckets.size < 512) {
      return;
    }
    for (const [key, bucket] of buckets) {
      if (bucket.resetAtMs <= nowMs) {
        buckets.delete(key);
      }
    }
  }

  return {
    async consume(key: string, now = new Date()): Promise<RateLimitDecision> {
      const nowMs = now.getTime();
      sweep(nowMs);
      const windowMs = options.windowSeconds * 1000;
      const existing = buckets.get(key);
      const bucket =
        existing && existing.resetAtMs > nowMs
          ? existing
          : { count: 0, resetAtMs: nowMs + windowMs };
      bucket.count += 1;
      buckets.set(key, bucket);

      const allowed = bucket.count <= options.maxRequests;
      const remaining = Math.max(0, options.maxRequests - bucket.count);
      const retryAfterSeconds = allowed
        ? 0
        : Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000));
      return {
        allowed,
        remaining,
        retryAfterSeconds,
        resetAt: new Date(bucket.resetAtMs),
      };
    },
  };
}
