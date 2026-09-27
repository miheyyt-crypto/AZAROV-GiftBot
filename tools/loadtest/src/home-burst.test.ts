import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  readyIsSelectOnly,
  startLoadHarness,
  type LoadHarness,
} from "./harness.js";
import { runHomeStartupLadder, runHomeStartupSteady } from "./scenarios.js";
import { seedLoadDataset, TELEGRAM_ID_BASE } from "./seed.js";
import { BURST_LADDER } from "./stats.js";

let harness: LoadHarness;

before(async () => {
  harness = await startLoadHarness({
    port: 55451,
    dbPoolMax: 20,
    rateLimitMax: 400,
  });
  await seedLoadDataset(harness.sql, { users: 200 });
});

after(async () => {
  await harness.stop();
});

function fiveXx(statuses: Record<string, number>): number {
  let n = 0;
  for (const [code, count] of Object.entries(statuses)) {
    if (code.startsWith("5")) {
      n += count;
    }
  }
  return n;
}

test("Mini App startup burst 25/50/100/150 unique users", { timeout: 900_000 }, async () => {
  let cursor = TELEGRAM_ID_BASE + 50_000;
  for (const concurrency of BURST_LADDER) {
    const result = await runHomeStartupLadder(harness, concurrency, cursor);
    cursor += concurrency;
    const okRatio =
      result.requests.total === 0
        ? 0
        : result.requests.ok / result.requests.total;
    console.log(
      JSON.stringify({
        name: result.name,
        requests: result.requests,
        latency: result.latency,
        dbBackends: result.dbBackends,
        eventLoop: result.eventLoop,
        resources: result.resources,
        durationMs: result.durationMs,
        rps: result.rps,
      }),
    );
    assert.ok(
      okRatio >= 0.99,
      `${result.name} success=${okRatio} ${JSON.stringify(result.requests)} p95=${String(result.latency.p95Ms)}`,
    );
    assert.equal(fiveXx(result.requests.statuses), 0, JSON.stringify(result));
    assert.equal(result.requests.statuses["429"] ?? 0, 0, JSON.stringify(result.requests));
    if (concurrency === 100) {
      assert.equal(result.requests.total, 700);
      assert.equal(result.requests.ok, 700);
    }
    assert.ok((result.dbBackends?.max ?? 0) <= 40, JSON.stringify(result.dbBackends));
  }
  const steady = await runHomeStartupSteady(harness, 100, cursor);
  console.log(
    JSON.stringify({
      name: steady.name,
      requests: steady.requests,
      latency: steady.latency,
      dbBackends: steady.dbBackends,
      durationMs: steady.durationMs,
    }),
  );
  assert.ok(steady.requests.ok / steady.requests.total >= 0.99, JSON.stringify(steady.requests));
  assert.equal(fiveXx(steady.requests.statuses), 0);
  assert.equal(await readyIsSelectOnly(harness.baseUrl), true);
});

test("100-user Home burst from one NAT IP does not 429 reads", { timeout: 300_000 }, async () => {
  const natHarness = await startLoadHarness({
    port: 55452,
    dbPoolMax: 20,
    rateLimitMax: 120,
  });
  try {
    await seedLoadDataset(natHarness.sql, { users: 120 });
    const result = await runHomeStartupLadder(
      natHarness,
      100,
      TELEGRAM_ID_BASE + 80_000,
      { namePrefix: "home-startup-nat", sharedIp: "203.0.113.10" },
    );
    console.log(
      JSON.stringify({
        name: result.name,
        requests: result.requests,
        latency: result.latency,
        dbBackends: result.dbBackends,
        durationMs: result.durationMs,
      }),
    );
    assert.equal(result.requests.statuses["429"] ?? 0, 0, JSON.stringify(result.requests));
    assert.equal(fiveXx(result.requests.statuses), 0);
    assert.equal(result.requests.total, 700);
    assert.equal(result.requests.ok, 700);
    assert.equal(await readyIsSelectOnly(natHarness.baseUrl), true);
  } finally {
    await natHarness.stop();
  }
});
