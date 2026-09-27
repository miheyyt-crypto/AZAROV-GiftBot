import { createMemoryRateLimiter } from "./memory.js";
import type { RateLimiter } from "./port.js";

export type TieredRateLimiterOptions = {
  windowSeconds: number;
  readMaxRequests: number;
  writeMaxRequests: number;
  authMaxRequests: number;
};

/**
 * One RateLimiter surface; bucket is chosen from the consume key:
 * - `auth:` → unauthenticated Telegram/admin login (IP)
 * - `:write:` → economic / authenticated POST
 * - otherwise → authenticated GET / admin IP reads
 */
export function createTieredMemoryRateLimiter(
  options: TieredRateLimiterOptions,
): RateLimiter {
  const read = createMemoryRateLimiter({
    windowSeconds: options.windowSeconds,
    maxRequests: options.readMaxRequests,
  });
  const write = createMemoryRateLimiter({
    windowSeconds: options.windowSeconds,
    maxRequests: options.writeMaxRequests,
  });
  const auth = createMemoryRateLimiter({
    windowSeconds: options.windowSeconds,
    maxRequests: options.authMaxRequests,
  });
  return {
    async consume(key, now) {
      if (key.startsWith("auth:")) {
        return auth.consume(key, now);
      }
      if (key.includes(":write:")) {
        return write.consume(key, now);
      }
      return read.consume(key, now);
    },
  };
}
