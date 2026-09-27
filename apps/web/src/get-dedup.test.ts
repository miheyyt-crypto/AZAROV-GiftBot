import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearGetDedupForTests,
  dedupeGet,
  ttlMsForGetPath,
} from "./get-dedup.js";

test("concurrent GET loads share one promise", async () => {
  clearGetDedupForTests();
  let loads = 0;
  const load = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return "ok";
  };
  const [a, b] = await Promise.all([
    dedupeGet("t", "/profile", load),
    dedupeGet("t", "/profile", load),
  ]);
  assert.equal(a, "ok");
  assert.equal(b, "ok");
  assert.equal(loads, 1);
});

test("mutable GET has no response TTL after the in-flight request finishes", async () => {
  clearGetDedupForTests();
  let loads = 0;
  const load = async () => {
    loads += 1;
    return loads;
  };
  assert.equal(await dedupeGet("t", "/profile", load), 1);
  assert.equal(await dedupeGet("t", "/bootstrap", load), 2);
  assert.equal(await dedupeGet("t", "/cases/free", load), 3);
  assert.equal(ttlMsForGetPath("/profile"), undefined);
  assert.equal(ttlMsForGetPath("/games/rolls/current"), undefined);
});

test("allowlisted catalog GET may reuse a TTL hit", async () => {
  clearGetDedupForTests();
  let loads = 0;
  const load = async () => {
    loads += 1;
    return loads;
  };
  const started = Date.now();
  assert.equal(await dedupeGet("t", "/shop/catalog", load, started), 1);
  assert.equal(await dedupeGet("t", "/shop/catalog", load, started + 1_000), 1);
  assert.equal(loads, 1);
  assert.equal(ttlMsForGetPath("/shop/catalog"), 30_000);
  assert.equal(ttlMsForGetPath("/leaderboard/balance"), 8_000);
  assert.equal(ttlMsForGetPath("/contest/referral/summary"), 8_000);
  assert.equal(ttlMsForGetPath("/contest/referral"), undefined);
});
