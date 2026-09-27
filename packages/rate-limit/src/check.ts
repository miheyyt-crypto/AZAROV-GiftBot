import { createMemoryRateLimiter } from "./memory.js";
import { createRateLimitPolicy } from "./policy.js";

const policy = createRateLimitPolicy();
const limiter = createMemoryRateLimiter({
  windowSeconds: policy.windowSeconds,
  maxRequests: policy.maxRequests,
});

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    msg: "rate-limit module ok",
    defaultsStatus: policy.defaultsStatus,
    consume: typeof limiter.consume,
  })}\n`,
);
