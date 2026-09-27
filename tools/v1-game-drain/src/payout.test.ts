import assert from "node:assert/strict";
import { test } from "node:test";
import { minesMultiplierBps, minesPotentialWin, towerPotentialWin } from "./v1-payout.js";

test("V1 mines payout: 5 mines / 1 safe / 100 stake = 121", () => {
  assert.equal(minesMultiplierBps(0, 5), 10_000);
  assert.equal(minesMultiplierBps(1, 5), 12_125);
  assert.equal(minesPotentialWin(100, 1, 5), 121);
});

test("V1 tower payout: 1 floor * 100 = 100; 11 floors * 100 = 5536", () => {
  assert.equal(towerPotentialWin(100, 0), 100);
  assert.equal(towerPotentialWin(100, 1), 100);
  assert.equal(towerPotentialWin(100, 11), 5536);
});
