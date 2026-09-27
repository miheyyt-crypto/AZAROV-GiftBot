import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startLoadHarness, type LoadHarness } from "./harness.js";
import { runLoadtest } from "./run.js";
import { USER_LADDER, WEBHOOK_BURST } from "./stats.js";

process.env.LOADTEST_MODE = "legacy";

let harness: LoadHarness;

before(async () => {
  harness = await startLoadHarness();
});

after(async () => {
  await harness.stop();
});

test("15/30/50/100 users and a webhook burst produce a latency/lock/CPU/RSS report", async () => {
  const report = await runLoadtest(harness);
  assert.equal(report.productionReadyClaim, false);
  assert.deepEqual(
    report.scenarios
      .filter((row) => row.name.startsWith("users-"))
      .map((row) => row.concurrency),
    [...USER_LADDER],
  );
  const burst = report.scenarios.find((row) =>
    row.name.startsWith("webhook-burst-"),
  );
  assert.ok(burst);
  assert.equal(burst.concurrency, WEBHOOK_BURST);
  for (const scenario of report.scenarios) {
    assert.ok(scenario.latency.count > 0);
    assert.ok(scenario.resources.rssBytes > 0);
    assert.ok("maxWaiting" in scenario.locks);
  }
  assert.deepEqual(report.blockers, []);
});
