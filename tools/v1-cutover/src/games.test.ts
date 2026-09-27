import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyMinesGame,
  classifyRollsRound,
  classifyTowerGame,
} from "./games.js";

test("waiting Rolls 0 bets is non-blocking", () => {
  const row = classifyRollsRound("roll_empty", {
    status: "waiting",
    players: [],
    pot: 0,
  });
  assert.equal(row.financiallyBlocking, false);
  assert.equal(row.staleNonFinancial, true);
  assert.equal(row.totalDebitedAzc, "0");
});

test("waiting Rolls with debited bet is blocking", () => {
  const row = classifyRollsRound("roll_bet", {
    status: "waiting",
    players: [{ userId: 1, bet: 250 }],
    pot: 250,
  });
  assert.equal(row.financiallyBlocking, true);
  assert.equal(row.totalDebitedAzc, "250");
  assert.equal(row.settlementPending, true);
});

test("active Mines after debit is blocking", () => {
  const row = classifyMinesGame("mines_1", {
    status: "playing",
    bet: 500,
    payout: null,
  });
  assert.equal(row.financiallyBlocking, true);
  assert.equal(row.totalDebitedAzc, "500");
});

test("already-lost Mines is non-blocking", () => {
  const row = classifyMinesGame("mines_lost", {
    status: "lost",
    bet: 100,
    payout: 0,
    finishedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(row.financiallyBlocking, false);
  assert.equal(row.settlementPending, false);
});

test("playing Tower after debit is blocking", () => {
  const row = classifyTowerGame("tower_1", { status: "playing", bet: 100 });
  assert.equal(row.financiallyBlocking, true);
  assert.equal(row.totalDebitedAzc, "100");
});

test("won Tower is non-blocking", () => {
  const row = classifyTowerGame("tower_w", {
    status: "won",
    bet: 100,
    payout: 180,
  });
  assert.equal(row.financiallyBlocking, false);
});
