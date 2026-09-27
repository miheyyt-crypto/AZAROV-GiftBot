import assert from "node:assert/strict";
import { test } from "node:test";
import { createTtlCache } from "./read-cache.js";

test("ttl cache coalesces concurrent loads", async () => {
  const cache = createTtlCache<number>(10_000);
  let loads = 0;
  const load = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return 7;
  };
  const [a, b] = await Promise.all([cache.get(load), cache.get(load)]);
  assert.equal(a, 7);
  assert.equal(b, 7);
  assert.equal(loads, 1);
  assert.equal(await cache.get(load), 7);
  assert.equal(loads, 1);
});
