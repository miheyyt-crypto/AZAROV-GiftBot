import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeLevel,
  getLevelProgress,
  LEVEL_TABLE,
  MAX_LEVEL,
  TOTAL_XP_TO_MAX_LEVEL,
  XP_TO_NEXT_LEVEL,
  rewardForReachedLevel,
  xpToReachLevel,
} from "./level.js";

test("new user with 0 XP is level 1 and next reward is 100", () => {
  const progress = getLevelProgress(0n);
  assert.equal(progress.current, 1);
  assert.equal(progress.currentLevelXp, 0n);
  assert.equal(progress.nextLevelXp, 200n);
  assert.equal(progress.xpNeededForNext, 200n);
  assert.equal(progress.progressRatio, 0);
  assert.equal(progress.nextRewardAzc, 100n);
});

test("level threshold is exclusive of the previous level", () => {
  const before = computeLevel(199n);
  const on = computeLevel(200n);
  assert.equal(before.current, 1);
  assert.equal(before.xpNeededForNext, 1n);
  assert.equal(before.nextRewardAzc, 100n);
  assert.equal(on.current, 2);
  assert.equal(on.currentLevelXp, 0n);
  assert.equal(on.nextLevelXp, 400n);
  assert.equal(on.nextRewardAzc, 200n);
});

test("approved early XP costs and max total are exact", () => {
  assert.equal(XP_TO_NEXT_LEVEL[0], 200n);
  assert.equal(XP_TO_NEXT_LEVEL[8], 5000n);
  const total = XP_TO_NEXT_LEVEL.reduce((sum, cost) => sum + cost, 0n);
  assert.equal(total, TOTAL_XP_TO_MAX_LEVEL);
  assert.equal(total, 2_307_800n);
  assert.equal(XP_TO_NEXT_LEVEL.length, MAX_LEVEL - 1);
  assert.equal(LEVEL_TABLE.at(-1)?.cumulativeXp, TOTAL_XP_TO_MAX_LEVEL);
});

test("checkpoint next-level AZC rewards", () => {
  assert.equal(getLevelProgress(0n).nextRewardAzc, 100n);
  assert.equal(getLevelProgress(xpToReachLevel(2)).nextRewardAzc, 200n);
  assert.equal(getLevelProgress(xpToReachLevel(9)).nextRewardAzc, 5000n);
  assert.equal(getLevelProgress(xpToReachLevel(10)).nextRewardAzc, 3000n);
  assert.equal(getLevelProgress(xpToReachLevel(19)).nextRewardAzc, 15000n);
  assert.equal(getLevelProgress(xpToReachLevel(29)).nextRewardAzc, 30000n);
  assert.equal(getLevelProgress(xpToReachLevel(39)).nextRewardAzc, 60000n);
  assert.equal(getLevelProgress(xpToReachLevel(49)).nextRewardAzc, 100000n);
});

test("rewardForReachedLevel matches transitions", () => {
  assert.equal(rewardForReachedLevel(1), null);
  assert.equal(rewardForReachedLevel(2), 100n);
  assert.equal(rewardForReachedLevel(10), 5000n);
  assert.equal(rewardForReachedLevel(11), 3000n);
  assert.equal(rewardForReachedLevel(50), 100000n);
  assert.equal(rewardForReachedLevel(51), null);
});

test("boundary level 10 next reward is the level 11 reward", () => {
  const atTen = getLevelProgress(xpToReachLevel(10));
  const levelElevenReward = LEVEL_TABLE[9]?.rewardAzc;
  assert.equal(atTen.current, 10);
  assert.equal(atTen.currentLevelXp, 0n);
  assert.equal(levelElevenReward, 3000n);
  assert.equal(atTen.nextRewardAzc, levelElevenReward);
  assert.notEqual(atTen.nextRewardAzc, 5000n);
});

test("exact total XP reaches level 50 with no next reward", () => {
  const atCap = computeLevel(TOTAL_XP_TO_MAX_LEVEL);
  const beyond = computeLevel(TOTAL_XP_TO_MAX_LEVEL + 50n);
  assert.equal(atCap.current, 50);
  assert.equal(atCap.nextLevelXp, null);
  assert.equal(atCap.xpNeededForNext, null);
  assert.equal(atCap.nextRewardAzc, null);
  assert.equal(atCap.progressRatio, 1);
  assert.equal(beyond.current, 50);
  assert.equal(beyond.currentLevelXp, 50n);
  assert.equal(beyond.nextRewardAzc, null);
});
