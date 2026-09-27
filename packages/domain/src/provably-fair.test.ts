import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MINES_MULTIPLIERS,
  SUPPORTED_MINE_COUNTS,
  safeCellCount,
} from "./mines-catalog.js";
import {
  assertServerSeedHash,
  deriveDiceRawResult,
  diceMultiplierDisplay,
  dicePayoutAzc,
  diceWinThreshold,
  floorBetTimesMultiplier,
  formatDiceDisplay,
  generateMinesBoard,
  generateServerSeed,
  hashServerSeed,
  isDiceWin,
  verifyDiceRound,
  verifyMinesBoard,
} from "./provably-fair.js";

test("mines multiplier tables have exact lengths and 65.70", () => {
  for (const count of SUPPORTED_MINE_COUNTS) {
    assert.equal(MINES_MULTIPLIERS[count].length, safeCellCount(count));
  }
  assert.equal(MINES_MULTIPLIERS[3][17], "65.70");
  assert.notEqual(MINES_MULTIPLIERS[3][17], "65.7");
});

test("floorBetTimesMultiplier uses integer math", () => {
  assert.equal(floorBetTimesMultiplier(1000n, "1.30"), 1300n);
  assert.equal(floorBetTimesMultiplier(100n, "65.70"), 6570n);
  assert.equal(floorBetTimesMultiplier(999n, "1.14"), 1138n);
});

test("provably fair hash and mines board are deterministic", () => {
  const serverSeed = "a".repeat(64);
  const hash = hashServerSeed(serverSeed);
  assert.equal(assertServerSeedHash(serverSeed, hash), true);
  const board1 = generateMinesBoard({
    serverSeed,
    clientSeed: "client-a",
    nonce: 7,
    mineCount: 5,
  });
  const board2 = generateMinesBoard({
    serverSeed,
    clientSeed: "client-a",
    nonce: 7,
    mineCount: 5,
  });
  assert.deepEqual(board1, board2);
  assert.equal(board1.length, 5);
  assert.equal(new Set(board1).size, 5);
  assert.ok(board1.every((c) => c >= 0 && c <= 24));
  assert.equal(
    verifyMinesBoard({
      serverSeed,
      clientSeed: "client-a",
      nonce: 7,
      mineCount: 5,
      minePositions: board1,
    }),
    true,
  );
  const other = generateMinesBoard({
    serverSeed,
    clientSeed: "client-a",
    nonce: 8,
    mineCount: 5,
  });
  assert.notDeepEqual(board1, other);
});

test("generateServerSeed is CSPRNG hex", () => {
  const a = generateServerSeed();
  const b = generateServerSeed();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("dice thresholds and payouts are exact", () => {
  assert.equal(diceWinThreshold(1), 10_000);
  assert.equal(diceWinThreshold(95), 950_000);
  assert.equal(isDiceWin(9_999, 1), true);
  assert.equal(isDiceWin(10_000, 1), false);
  assert.equal(isDiceWin(949_999, 95), true);
  assert.equal(isDiceWin(950_000, 95), false);
  assert.equal(dicePayoutAzc(100n, 1), 10_000n);
  assert.equal(dicePayoutAzc(100n, 50), 200n);
  assert.equal(dicePayoutAzc(100n, 95), 105n);
  assert.equal(dicePayoutAzc(999n, 33), 3027n);
  assert.equal(diceMultiplierDisplay(1), "100.00");
  assert.equal(diceMultiplierDisplay(50), "2.00");
  assert.equal(diceMultiplierDisplay(95), "1.05");
  assert.equal(formatDiceDisplay(123456), "12.34");
});

test("dice raw result is deterministic and verifiable", () => {
  const serverSeed = "b".repeat(64);
  const raw = deriveDiceRawResult({
    serverSeed,
    clientSeed: "d1",
    nonce: 3,
  });
  assert.equal(
    deriveDiceRawResult({ serverSeed, clientSeed: "d1", nonce: 3 }),
    raw,
  );
  assert.ok(raw >= 0 && raw <= 999_999);
  const win = isDiceWin(raw, 50);
  assert.equal(
    verifyDiceRound({
      serverSeed,
      serverSeedHash: hashServerSeed(serverSeed),
      clientSeed: "d1",
      nonce: 3,
      chance: 50,
      rawResult: raw,
      win,
    }),
    true,
  );
});
