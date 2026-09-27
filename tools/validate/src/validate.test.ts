import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateChecklist, assertChecklistClosed } from "./checklist.js";
import { assertAllPendingFlaggedOff, PENDING_FLAG, PENDING_GO_LIVE_FLAGS } from "./pending.js";
import { runValidation } from "./validate.js";

test("9 remaining pending product decisions stay flagged off; referral, shop, tasks, cases, and session TTL decided", () => {
  assertAllPendingFlaggedOff();
  assert.equal(PENDING_GO_LIVE_FLAGS.length, 9);
  assert.ok(PENDING_GO_LIVE_FLAGS.every((row) => row.flag === PENDING_FLAG));
  assert.ok(
    PENDING_GO_LIVE_FLAGS.every(
      (row) =>
        row.id !== 1 &&
        row.id !== 5 &&
        row.id !== 7 &&
        row.id !== 8 &&
        row.id !== 9,
    ),
  );
});

test("live architecture checklist is closed", async () => {
  const items = await evaluateChecklist();
  assertChecklistClosed(items);
  assert.ok(items.some((item) => item.id === "deploy" && item.status === "pass"));
  assert.ok(
    items.some((item) => item.id === "pending-flagged-off" && item.status === "flagged_off"),
  );
});

test("load smoke plus checklist close without a production-ready claim", async () => {
  const report = await runValidation();
  assert.equal(report.closed, true);
  assert.equal(report.productionReadyClaim, false);
  assert.equal(report.loadSmoke.users, 15);
  assert.equal(report.loadSmoke.webhookBurst, 20);
  assert.deepEqual(report.loadSmoke.blockers, []);
});
