import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldSkipRollsWsSnapshot } from "./rolls-ws-fanout.js";

test("WS fan-out skips older version only on the same round", () => {
  assert.equal(
    shouldSkipRollsWsSnapshot(
      { roundId: "old", roundVersion: "8" },
      { roundId: "old", version: "7" },
    ),
    true,
  );
  assert.equal(
    shouldSkipRollsWsSnapshot(
      { roundId: "old", roundVersion: "8" },
      { roundId: "old", version: "8" },
    ),
    false,
  );
});

test("WS fan-out sends a new roundId even when its version is lower", () => {
  assert.equal(
    shouldSkipRollsWsSnapshot(
      { roundId: "ended-spin", roundVersion: "12" },
      { roundId: "next-waiting", version: "1" },
    ),
    false,
  );
});

test("simultaneous GET current does not skip next-round WS by itself", () => {
  assert.equal(
    shouldSkipRollsWsSnapshot({}, { roundId: "a", version: "1" }),
    false,
  );
});
