import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdempotencyKey, retryKeyFor } from "./idempotency.js";
import {
  assertStartupBudget,
  planStartup,
  sessionIsUsable,
} from "./startup.js";

test("cold start uses two sequential critical requests until the shell", () => {
  const plan = planStartup(false);
  assert.deepEqual(plan.untilUsable, ["auth", "bootstrap"]);
  assert.equal(plan.sequentialCritical, 2);
  assert.equal(plan.parallelCritical, 0);
  assert.deepEqual(plan.afterShell, [
    "free-case",
    "recent-wins",
    "stream-streak",
    "leaderboard",
    "giveaways",
    "contest-summary",
  ]);
  assertStartupBudget(plan);
});

test("warm start skips auth and stays within the request budget", () => {
  const plan = planStartup(true);
  assert.deepEqual(plan.untilUsable, ["bootstrap"]);
  assert.equal(plan.sequentialCritical, 1);
  assertStartupBudget(plan);
});

test("expired cached session is not usable", () => {
  assert.equal(
    sessionIsUsable({ expiresAt: "2020-01-01T00:00:00.000Z" }, new Date("2026-09-13T00:00:00.000Z")),
    false,
  );
  assert.equal(
    sessionIsUsable({ expiresAt: "2026-09-14T00:00:00.000Z" }, new Date("2026-09-13T00:00:00.000Z")),
    true,
  );
});

test("POST retries reuse the same idempotency key", () => {
  const first = createIdempotencyKey();
  assert.equal(retryKeyFor("POST /example", first), first);
  assert.notEqual(createIdempotencyKey(), first);
});
