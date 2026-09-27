import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStreamStreak } from "./parse.js";
import { EMPTY_STREAM_STREAK } from "./types.js";

test("parseStreamStreak accepts offline shape", () => {
  const parsed = parseStreamStreak({
    currentStreak: 4,
    completed: false,
    nextTarget: 5,
    nextRewardAzc: "500",
    freezeCount: 2,
    stream: { isLive: false },
  });
  assert.equal(parsed.currentStreak, 4);
  assert.equal(parsed.nextRewardAzc, "500");
  assert.equal(parsed.stream.isLive, false);
});

test("parseStreamStreak accepts live qualified shape", () => {
  const parsed = parseStreamStreak({
    ...EMPTY_STREAM_STREAK,
    currentStreak: 10,
    completed: true,
    nextTarget: null,
    nextRewardAzc: null,
    stream: {
      isLive: true,
      sessionId: "s1",
      messages: 10,
      requiredMessages: 10,
      qualified: true,
    },
  });
  assert.equal(parsed.completed, true);
  assert.ok(parsed.stream.isLive);
  if (parsed.stream.isLive) {
    assert.equal(parsed.stream.qualified, true);
  }
});
