import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isIdempotentRead,
  retryAfterMs,
  retryDelayMs,
  shouldRetryGetStatus,
} from "./http-retry.js";

test("GET retry delay uses exponential backoff and jitter", () => {
  const first = retryDelayMs(0, () => 0);
  const firstHigh = retryDelayMs(0, () => 0.999);
  assert.equal(first, 250);
  assert.ok(firstHigh >= 250 && firstHigh <= 500);
  const second = retryDelayMs(1, () => 0);
  assert.equal(second, 500);
  assert.ok(retryDelayMs(1, () => 0.999) <= 1000);
});

test("only transient GET statuses are retried", () => {
  assert.equal(shouldRetryGetStatus(503), true);
  assert.equal(shouldRetryGetStatus(429), true);
  assert.equal(shouldRetryGetStatus(401), false);
  assert.equal(shouldRetryGetStatus(400), false);
  assert.equal(isIdempotentRead("GET"), true);
  assert.equal(isIdempotentRead("POST"), false);
});

test("429 Retry-After is capped and jittered", () => {
  const withHeader = retryAfterMs("2", 0, () => 0);
  assert.equal(withHeader, 2000);
  assert.ok(retryAfterMs("30", 0, () => 0) <= 5000);
  const noHeader = retryAfterMs(null, 0, () => 0);
  assert.equal(noHeader, 250);
});
