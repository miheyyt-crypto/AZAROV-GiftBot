import assert from "node:assert/strict";
import { test } from "node:test";
import { createBootGenerationGuard } from "./boot-guard.js";

test("boot generation guard ignores stale results after cancel", () => {
  const guard = createBootGenerationGuard();
  const first = guard.next();
  assert.equal(guard.isCurrent(first), true);
  guard.cancel();
  assert.equal(guard.isCurrent(first), false);
  const second = guard.next();
  assert.equal(guard.isCurrent(second), true);
  assert.equal(guard.isCurrent(first), false);
});
