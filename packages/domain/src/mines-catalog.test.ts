import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MINES_MIN_BET,
  firstClickLossProbability,
} from "./mines-catalog.js";
import { generateMinesBoard } from "./provably-fair.js";

test("mines first-click loss is selectedMineCount / 25 and board length matches selection", () => {
  assert.equal(MINES_MIN_BET, 100n);
  assert.equal(firstClickLossProbability(3), 3 / 25);
  assert.equal(firstClickLossProbability(5), 5 / 25);
  assert.equal(firstClickLossProbability(24), 24 / 25);
  const seed = "b".repeat(64);
  for (const mineCount of [3, 5, 24] as const) {
    const board = generateMinesBoard({
      serverSeed: seed,
      clientSeed: "exact-count",
      nonce: mineCount,
      mineCount,
    });
    assert.equal(board.length, mineCount);
    assert.equal(new Set(board).size, mineCount);
  }
});
