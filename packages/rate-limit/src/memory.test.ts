import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryRateLimiter } from "./memory.js";

test("allows requests until the window max and then denies", async () => {
  const limiter = createMemoryRateLimiter({ windowSeconds: 60, maxRequests: 2 });
  const first = await limiter.consume("ip:1");
  const second = await limiter.consume("ip:1");
  const third = await limiter.consume("ip:1");
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSeconds >= 1);
});

test("separate keys do not share a bucket", async () => {
  const limiter = createMemoryRateLimiter({ windowSeconds: 60, maxRequests: 1 });
  assert.equal((await limiter.consume("a")).allowed, true);
  assert.equal((await limiter.consume("b")).allowed, true);
  assert.equal((await limiter.consume("a")).allowed, false);
});

test("tiered limiter isolates auth IP, read, and write", async () => {
  const { createTieredMemoryRateLimiter } = await import("./tiered.js");
  const limiter = createTieredMemoryRateLimiter({
    windowSeconds: 60,
    readMaxRequests: 2,
    writeMaxRequests: 1,
    authMaxRequests: 1,
  });
  assert.equal((await limiter.consume("auth:ip:1")).allowed, true);
  assert.equal((await limiter.consume("auth:ip:1")).allowed, false);
  assert.equal((await limiter.consume("profile:read:user:a")).allowed, true);
  assert.equal((await limiter.consume("profile:read:user:a")).allowed, true);
  assert.equal((await limiter.consume("profile:read:user:a")).allowed, false);
  assert.equal((await limiter.consume("profile:read:user:b")).allowed, true);
  assert.equal((await limiter.consume("cases:write:user:a")).allowed, true);
  assert.equal((await limiter.consume("cases:write:user:a")).allowed, false);
});
