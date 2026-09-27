import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countdownSecondsLeft,
  forwardSpinTarget,
  interpolatedRotation,
  ROLLS_SPIN_DURATION_MS,
  ROLLS_SPIN_EXTRA_TURNS,
  rollsHubAriaLabel,
  rollsHubView,
  shouldIgnoreStaleVersion,
  shouldShowRollsResult,
  spinEase,
  spinLinearProgress,
  targetRotationForWinner,
} from "./rolls-spin.js";
import { parseRollsCurrent } from "./rolls-parse.js";
import { buildSectors, ROLLS_IDLE_TURN_MS } from "./rolls-wheel.js";
import {
  formatChancePercent,
  formatRollsGameTitle,
  previousHistoryItem,
  rollsWinnerCardName,
  topHistoryItem,
  winMultiplier,
  winnerChancePercent,
} from "./rolls-ui.js";

test("second-player betting hub starts at 20s not spin 8s", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const bettingEnds = now + 20_000;
  const left = countdownSecondsLeft(
    new Date(bettingEnds).toISOString(),
    now,
    0,
  );
  assert.equal(left, 20);
  assert.notEqual(left, 8);
  assert.equal(ROLLS_SPIN_DURATION_MS, 8000);
  const hub = rollsHubView({ status: "betting", participantCount: 2 }, left);
  assert.deepEqual(hub, { kind: "betting", seconds: 20 });
  assert.equal(rollsHubAriaLabel(hub), "СТАРТ ЧЕРЕЗ 20");
  assert.doesNotMatch(rollsHubAriaLabel(hub), /СТАРТ ЧЕРЕЗ 8/);
});

test("rolls hub waiting vs betting countdown vs spinning", () => {
  assert.equal(rollsHubView(null, null).kind, "waiting");
  assert.equal(
    rollsHubView({ status: "waiting", participantCount: 0 }, null).kind,
    "waiting",
  );
  assert.equal(
    rollsHubView({ status: "waiting", participantCount: 1 }, 20).kind,
    "waiting",
  );
  const betting = rollsHubView({ status: "betting", participantCount: 2 }, 20);
  assert.deepEqual(betting, { kind: "betting", seconds: 20 });
  assert.equal(rollsHubAriaLabel(betting), "СТАРТ ЧЕРЕЗ 20");
  assert.doesNotMatch(rollsHubAriaLabel(betting), /Ожидание/);
  assert.deepEqual(
    rollsHubView({ status: "betting", participantCount: 2 }, 1),
    { kind: "betting", seconds: 1 },
  );
  assert.equal(
    rollsHubView({ status: "spinning", participantCount: 2 }, 0).kind,
    "spinning",
  );
  assert.equal(
    rollsHubAriaLabel({ kind: "spinning" }),
    "КРУТИМ",
  );
});

test("rolls spin lasts 8000ms and result waits for completion", () => {
  assert.equal(ROLLS_SPIN_DURATION_MS, 8000);
  const start = 1_000_000;
  const duration = ROLLS_SPIN_DURATION_MS;
  assert.equal(spinLinearProgress(start, start, duration, 0), 0);
  assert.equal(shouldShowRollsResult(0), false);
  const at4 = spinLinearProgress(start + 4_000, start, duration, 0);
  assert.equal(at4, 0.5);
  assert.equal(shouldShowRollsResult(at4), false);
  assert.ok(spinEase(at4) < 1);
  assert.ok(spinLinearProgress(start + 7_999, start, duration, 0) < 1);
  assert.equal(spinLinearProgress(start + 8_000, start, duration, 0), 1);
  assert.equal(shouldShowRollsResult(1), true);
});

test("rolls spin reconnect at 4s uses elapsed progress not a restart", () => {
  const start = 5_000_000;
  const duration = ROLLS_SPIN_DURATION_MS;
  const p = spinLinearProgress(start + 4_000, start, duration, 0);
  assert.equal(p, 0.5);
  assert.ok(p > 0 && p < 1);
});

test("rolls easing is fast then settles without finishing at 4s", () => {
  assert.equal(spinEase(0), 0);
  assert.equal(spinEase(1), 1);
  assert.ok(spinEase(0.35) > 0.45);
  assert.ok(spinEase(0.35) < 0.75);
  assert.ok(spinEase(0.8125) < 0.98);
  assert.ok(spinEase(0.8125) > 0.88);
});

test("idle-to-spin interpolation does not snap at t=0", () => {
  const from = 1.37;
  const to = forwardSpinTarget({
    from,
    winnerIndex: 1,
    sectorAngles: [Math.PI, Math.PI],
  });
  assert.equal(interpolatedRotation(from, to, 0), from);
  assert.ok(to > from + ROLLS_SPIN_EXTRA_TURNS * Math.PI * 2 - 0.001);
  assert.ok(to - from >= ROLLS_SPIN_EXTRA_TURNS * Math.PI * 2);
  const landed = interpolatedRotation(from, to, 1);
  assert.equal(landed, to);
});

test("rolls winner sector target is finite and extra turns are visual only", () => {
  const angles = [Math.PI, Math.PI];
  const rot = targetRotationForWinner({ winnerIndex: 1, sectorAngles: angles });
  assert.ok(Number.isFinite(rot));
  assert.ok(rot > Math.PI * 2);
  assert.equal(ROLLS_SPIN_EXTRA_TURNS >= 5 && ROLLS_SPIN_EXTRA_TURNS <= 8, true);
});

test("rolls stale version ignored and countdown uses server offset", () => {
  assert.equal(shouldIgnoreStaleVersion("15", "14"), true);
  assert.equal(shouldIgnoreStaleVersion("14", "15"), false);
  assert.equal(shouldIgnoreStaleVersion(null, "1"), false);
  const now = Date.parse("2026-01-01T00:00:20.000Z");
  const left = countdownSecondsLeft(
    "2026-01-01T00:00:30.000Z",
    now,
    0,
  );
  assert.equal(left, 10);
});

test("parseRollsCurrent accepts compact snapshot", () => {
  const parsed = parseRollsCurrent({
    serverTime: "2026-01-01T00:00:00.000Z",
    you: { stakeAzc: "100", chancePercent: "10.00", participantId: "p1" },
    round: {
      roundId: "r1",
      status: "betting",
      version: "3",
      participantCount: 2,
      totalPotAzc: "1000",
      bettingDeadline: "2026-01-01T00:00:20.000Z",
      bettingStartedAt: "2026-01-01T00:00:00.000Z",
      spinStartedAt: null,
      spinDurationMs: 8000,
      serverSeedHash: "abc",
      serverSeed: null,
      nonce: "0",
      algorithm: "azarov:v1:rolls",
      aggregateClientSeed: null,
      participantSnapshotHash: null,
      winningTicket: null,
      winnerParticipantId: null,
      winnerUserId: null,
      payoutAzc: null,
      participants: [
        {
          participantId: "p1",
          publicId: "u1",
          displayName: "A",
          avatarKey: null,
          avatarUrl: null,
          stakeAzc: "900",
          joinedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          participantId: "p2",
          publicId: "u2",
          displayName: "B",
          avatarKey: null,
          avatarUrl: null,
          stakeAzc: "100",
          joinedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      resolvedAt: null,
    },
  });
  assert.equal(parsed.round.participantCount, 2);
  assert.equal(parsed.you?.chancePercent, "10.00");
  assert.equal(parsed.round.spinDurationMs, 8000);
  assert.equal(parsed.previous, null);
  assert.equal(parsed.top, null);
});

test("waiting idle turn is a slow continuous revolution", () => {
  assert.ok(ROLLS_IDLE_TURN_MS >= 18_000);
  assert.ok(ROLLS_IDLE_TURN_MS <= 30_000);
  const waiting = buildSectors([], 0);
  assert.equal(waiting.length, 8);
  assert.equal(waiting[0]?.displayName, "");
  const a = (2 * Math.PI) / 8;
  assert.ok(Math.abs((waiting[0]?.sweep ?? 0) - a) < 1e-9);
  const real = buildSectors(
    [
      {
        participantId: "p1",
        publicId: "u1",
        displayName: "A",
        avatarKey: null,
        avatarUrl: null,
        stakeAzc: "750",
        joinedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        participantId: "p2",
        publicId: "u2",
        displayName: "B",
        avatarKey: "https://example.test/a.png",
        avatarUrl: "https://example.test/a.png",
        stakeAzc: "250",
        joinedAt: "2026-01-01T00:00:01.000Z",
      },
    ],
    1000,
  );
  assert.equal(real.length, 2);
  assert.ok(Math.abs(real[0]!.sweep / real[1]!.sweep - 3) < 1e-9);
  assert.equal(real[1]?.avatarKey, "https://example.test/a.png");
});

test("history helpers pick previous and top without inventing names", () => {
  assert.equal(formatChancePercent("44.00"), "44");
  assert.equal(formatChancePercent("44.35"), "44.35");
  assert.equal(formatRollsGameTitle("100434"), "Игра #100434");
  assert.equal(winnerChancePercent("100", "854"), "11.71");
  assert.equal(winMultiplier("854", "100"), "8.54");
  const items = [
    {
      roundId: "1",
      ownStakeAzc: "100",
      totalPotAzc: "500",
      chancePercent: "20.00",
      won: false,
      payoutAzc: "0",
      participantCount: 3,
      resolvedAt: null,
      serverSeedHash: "h",
      serverSeed: null,
    },
    {
      roundId: "2",
      ownStakeAzc: "100",
      totalPotAzc: "9000",
      chancePercent: "1.11",
      won: true,
      payoutAzc: "9000",
      participantCount: 4,
      resolvedAt: null,
      serverSeedHash: "h",
      serverSeed: null,
    },
  ];
  assert.equal(previousHistoryItem(items)?.roundId, "1");
  assert.equal(topHistoryItem(items)?.roundId, "2");
});

test("rolls board card name uses winnerId not the viewing client", () => {
  assert.equal(rollsWinnerCardName("user-b", "Bob", "user-a"), "Bob");
  assert.equal(rollsWinnerCardName("user-b", "Bob", "user-b"), "Вы");
  assert.equal(rollsWinnerCardName("user-b", "Bob", null), "Bob");
  assert.notEqual(rollsWinnerCardName("user-b", "Bob", "user-a"), "Вы");
});
