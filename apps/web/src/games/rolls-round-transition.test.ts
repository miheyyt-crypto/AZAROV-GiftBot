import assert from "node:assert/strict";
import { test } from "node:test";
import type { RollsCurrent } from "./rolls-types.js";
import {
  decideRollsSnapshotApply,
  isPlayableRollsStatus,
  loadNextRollsRound,
  mergeRollsYou,
  ROLLS_NEXT_ROUND_RETRY_MS,
  ROLLS_RESULT_HOLD_MS,
  shouldIgnoreStaleRollsSnapshot,
} from "./rolls-round-transition.js";

function waitingRound(roundId: string, version = "1"): RollsCurrent {
  return {
    serverTime: "2026-01-01T00:00:10.000Z",
    you: { userId: "u1", stakeAzc: "0", chancePercent: "0.00", participantId: null },
    previous: {
      roundId: "ended",
      winnerId: "user-b",
      winnerName: "Bob",
      winnerUsername: "bob",
      winnerAvatar: null,
      winnerInitials: "B",
      amount: "500",
      chance: "80.00",
      finishedAt: "2026-01-01T00:00:08.000Z",
    },
    top: null,
    round: {
      roundId,
      status: "waiting",
      version,
      participantCount: 0,
      totalPotAzc: "0",
      bettingDeadline: null,
      bettingStartedAt: null,
      spinStartedAt: null,
      spinDurationMs: 8000,
      serverSeedHash: "h",
      serverSeed: null,
      nonce: "2",
      algorithm: "azarov:v1:rolls",
      aggregateClientSeed: null,
      participantSnapshotHash: null,
      winningTicket: null,
      winnerParticipantId: null,
      winnerUserId: null,
      payoutAzc: null,
      participants: [],
      createdAt: "2026-01-01T00:00:09.000Z",
      resolvedAt: null,
    },
  };
}

test("result hold is a few seconds then GET retries are sparse", () => {
  assert.ok(ROLLS_RESULT_HOLD_MS >= 2000 && ROLLS_RESULT_HOLD_MS <= 4000);
  assert.deepEqual([...ROLLS_NEXT_ROUND_RETRY_MS], [300, 700, 1500]);
});

test("stale version is ignored only on the same roundId", () => {
  assert.equal(
    shouldIgnoreStaleRollsSnapshot({
      localRoundId: "ended",
      localVersion: "9",
      incomingRoundId: "ended",
      incomingVersion: "8",
    }),
    true,
  );
  assert.equal(
    shouldIgnoreStaleRollsSnapshot({
      localRoundId: "ended",
      localVersion: "9",
      incomingRoundId: "next",
      incomingVersion: "1",
    }),
    false,
  );
});

test("ended spinning defers next waiting until result hold ends", () => {
  assert.equal(
    decideRollsSnapshotApply({
      localRoundId: "ended",
      localVersion: "9",
      incomingRoundId: "next",
      incomingVersion: "1",
      fromWs: true,
      holdLocalRound: true,
    }),
    "defer",
  );
  assert.equal(
    decideRollsSnapshotApply({
      localRoundId: "ended",
      localVersion: "9",
      incomingRoundId: "next",
      incomingVersion: "1",
      fromWs: true,
      holdLocalRound: false,
    }),
    "apply-reset",
  );
});

test("same-round spin snapshot still applies during hold", () => {
  assert.equal(
    decideRollsSnapshotApply({
      localRoundId: "ended",
      localVersion: "8",
      incomingRoundId: "ended",
      incomingVersion: "9",
      fromWs: true,
      holdLocalRound: true,
    }),
    "apply",
  );
});

test("websocket reconnect GET applies a new roundId and clears you from the old round", () => {
  const merged = mergeRollsYou(
    { userId: "u1", stakeAzc: "400", chancePercent: "40.00", participantId: "p-old" },
    undefined,
    true,
  );
  assert.deepEqual(merged, {
    userId: "u1",
    stakeAzc: "0",
    chancePercent: "0.00",
    participantId: null,
  });
  assert.equal(isPlayableRollsStatus("waiting"), true);
  assert.equal(isPlayableRollsStatus("betting"), true);
  assert.equal(isPlayableRollsStatus("resolved"), false);
});

test("missed next-round WS recovers via GET after retries", async () => {
  let calls = 0;
  const ended = waitingRound("ended", "9");
  ended.round.status = "spinning";
  const next = waitingRound("next", "1");
  const sleeps: number[] = [];
  const fresh = await loadNextRollsRound({
    endedRoundId: "ended",
    delaysMs: [300, 700],
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    load: async () => {
      calls += 1;
      if (calls < 3) {
        return ended;
      }
      return next;
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [300, 700]);
  assert.equal(fresh?.round.roundId, "next");
  assert.equal(fresh?.round.status, "waiting");
  assert.equal(fresh?.previous?.winnerId, "user-b");
  assert.notEqual(fresh?.previous?.winnerName, "Вы");
});

test("countdown next round is applied as-is after hold", () => {
  const next = waitingRound("next-2", "2");
  next.round.status = "betting";
  next.round.participantCount = 2;
  next.round.bettingDeadline = "2026-01-01T00:00:30.000Z";
  assert.equal(
    decideRollsSnapshotApply({
      localRoundId: "ended",
      localVersion: "4",
      incomingRoundId: next.round.roundId,
      incomingVersion: next.round.version,
      fromWs: false,
      holdLocalRound: false,
    }),
    "apply-reset",
  );
  assert.equal(isPlayableRollsStatus(next.round.status), true);
});
