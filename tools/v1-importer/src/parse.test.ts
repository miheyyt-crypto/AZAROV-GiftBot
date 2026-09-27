import assert from "node:assert/strict";
import { test } from "node:test";
import { parseV1Export, V1ExportError } from "./parse.js";

test("parses a giftbot-v1-export mapping", () => {
  const doc = parseV1Export({
    format: "giftbot-v1-export",
    version: 1,
    users: [
      {
        telegram_user_id: "1001",
        first_name: "Ada",
        balance_minor: 250,
      },
    ],
  });
  assert.equal(doc.users[0]?.telegramUserId, 1001n);
  assert.equal(doc.users[0]?.balanceMinor, 250n);
});

test("rejects store.json as an import store", () => {
  assert.throws(
    () =>
      parseV1Export({
        store: { users: [] },
        format: "giftbot-v1-export",
        version: 1,
        users: [],
      }),
    V1ExportError,
  );
});

test("rejects unknown V1 blobs instead of guessing a store.json shape", () => {
  assert.throws(() => parseV1Export({ users: { "1001": { coins: 5 } } }), /giftbot-v1-export/);
});

test("rejects duplicate telegram ids and negative balances", () => {
  assert.throws(
    () =>
      parseV1Export({
        format: "giftbot-v1-export",
        version: 1,
        users: [
          { telegram_user_id: 1, balance_minor: 1 },
          { telegram_user_id: 1, balance_minor: 2 },
        ],
      }),
    /duplicate telegram_user_id/,
  );
  assert.throws(
    () =>
      parseV1Export({
        format: "giftbot-v1-export",
        version: 1,
        users: [{ telegram_user_id: 1, balance_minor: -1 }],
      }),
    /balance_minor must be >= 0/,
  );
});
