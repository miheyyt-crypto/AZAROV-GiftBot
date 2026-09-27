import assert from "node:assert/strict";
import { test } from "node:test";
import { toDrainReport, reportContainsSecretLeak } from "./audit.js";
import { drainFixture } from "./fixtures.js";
import { planMinesGame, planRollsRound, planTowerGame } from "./plan.js";

test("Mines unresolved immediately after start recommends refund", () => {
  const plan = planMinesGame("m1", {
    status: "playing",
    bet: 100,
    mineCount: 5,
    gridSize: 25,
    revealed: [],
  });
  assert.equal(plan.recommended, "refund");
  assert.equal(plan.cashoutAvailable, false);
  assert.equal(plan.stake, 100);
});

test("Mines unresolved after safe picks recommends V1 cashout", () => {
  const plan = planMinesGame("m2", {
    status: "playing",
    bet: 100,
    mineCount: 5,
    gridSize: 25,
    revealed: [1],
  });
  assert.equal(plan.recommended, "cashout");
  assert.equal(plan.cashoutAmount, 121);
});

test("Mines already lost is skip", () => {
  const plan = planMinesGame("m3", { status: "lost", bet: 100, mineCount: 5, revealed: [1] });
  assert.equal(plan.recommended, "skip");
});

test("Mines already cashed out is skip", () => {
  const plan = planMinesGame("m4", { status: "won", bet: 100, payout: 121, revealed: [1] });
  assert.equal(plan.recommended, "skip");
});

test("Tower unresolved immediately after start recommends refund", () => {
  const plan = planTowerGame("t1", { status: "playing", bet: 100, floorsCleared: 0 });
  assert.equal(plan.recommended, "refund");
});

test("Tower unresolved after progress recommends V1 cashout", () => {
  const plan = planTowerGame("t2", { status: "playing", bet: 100, floorsCleared: 1 });
  assert.equal(plan.recommended, "cashout");
  assert.equal(plan.cashoutAmount, 100);
});

test("Tower already lost is skip", () => {
  assert.equal(planTowerGame("t3", { status: "lost", bet: 100, floorsCleared: 0 }).recommended, "skip");
});

test("Tower already cashed out is skip", () => {
  assert.equal(planTowerGame("t4", { status: "won", bet: 100, floorsCleared: 2 }).recommended, "skip");
});

test("empty Rolls waiting is skip / non-blocking", () => {
  const plan = planRollsRound("r1", { status: "waiting", players: [], pot: 0 });
  assert.equal(plan.recommended, "skip");
  const report = toDrainReport("memory://r", "abc", drainFixture({ rollRounds: { r1: { status: "waiting", players: [], pot: 0 } } }), "audit");
  assert.equal(report.financiallyBlocking, 0);
});

test("Rolls with real bet recommends refund", () => {
  const plan = planRollsRound("r2", {
    status: "waiting",
    players: [{ userId: 1, bet: 250 }],
    pot: 250,
  });
  assert.equal(plan.recommended, "refund");
  assert.equal(plan.stake, 250);
});

test("malformed playing mines blocks instead of guessing", () => {
  const plan = planMinesGame("bad", { status: "playing", bet: "nope", mineCount: 5, revealed: [] });
  assert.equal(plan.recommended, "block");
});

test("audit report has no secrets", () => {
  const report = toDrainReport(
    "memory://s",
    "deadbeef",
    drainFixture({
      minesGames: {
        m: { status: "playing", bet: 100, mineCount: 5, gridSize: 25, revealed: [], userId: 1 },
      },
    }),
    "audit",
  );
  const json = JSON.stringify(report);
  assert.equal(reportContainsSecretLeak(json), false);
  assert.ok(!json.includes("accessToken"));
});
