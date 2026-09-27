import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProfileLedger, parseProfileNotifications, parseProfileSummary } from "./parse.js";
import { EMPTY_PROFILE_SUMMARY } from "./types.js";

test("parseProfileSummary accepts the empty API shape", () => {
  const parsed = parseProfileSummary(EMPTY_PROFILE_SUMMARY);
  assert.equal(parsed.balances.azc, "0");
  assert.equal(parsed.level.current, 1);
  assert.equal(parsed.level.nextRewardAzc, "100");
  assert.equal(parsed.integrations.welvura.status, "not_linked");
  assert.equal(parsed.gram.minimumWithdrawal, "20");
  assert.equal(parsed.gram.canWithdraw, false);
  assert.equal(parsed.user.avatarUrl, null);
  assert.equal(parsed.integrations.kick.avatarUrl, null);
});

test("parseProfileSummary rejects an unsafe payload", () => {
  assert.throws(() => parseProfileSummary({ user: { id: 1 } }));
});

test("parseProfileNotifications accepts an empty page", () => {
  const parsed = parseProfileNotifications({ items: [], nextCursor: null });
  assert.deepEqual(parsed.items, []);
  assert.equal(parsed.nextCursor, null);
});

test("parseProfileLedger keeps amount strings", () => {
  const parsed = parseProfileLedger({
    items: [
      {
        id: "tx-1",
        type: "referral_reward",
        label: "Реферальная награда",
        delta: "1000",
        balanceAfter: "1000",
        createdAt: "2026-09-14T00:00:00.000Z",
      },
    ],
    nextCursor: null,
  });
  assert.equal(parsed.items[0]?.delta, "1000");
});
