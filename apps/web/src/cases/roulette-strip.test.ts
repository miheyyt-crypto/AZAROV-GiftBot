import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CASE_ROULETTE_ANIMATION_MS,
  CASE_ROULETTE_OPEN_SEQUENCE_MS,
  pinWinnerOnStrip,
  pointerCenterX,
  chipCenterX,
  rouletteCenterOffsetPx,
  rouletteSpinTransform,
  stripIndexUnderCenterPointer,
  ROULETTE_GAP,
  ROULETTE_ITEM_WIDTH,
  ROULETTE_STRIDE,
} from "./roulette-strip.js";

const CATALOG = [
  { itemCode: "gram-100", title: "100 Gram", rewardType: "gram" as const },
  { itemCode: "gram-50", title: "50 Gram", rewardType: "gram" as const },
  { itemCode: "azc-100", title: "100 AZC", rewardType: "azc" as const },
  { itemCode: "azc-50", title: "50 AZC", rewardType: "azc" as const },
];

test("winning chip is the backend object, not catalog index", () => {
  const winner = {
    itemCode: "gram-50",
    title: "50 Gram",
    rewardType: "gram" as const,
  };
  const reversed = [...CATALOG].reverse();
  const plan = pinWinnerOnStrip(reversed, winner);
  const landed = plan.strip[plan.stopIndex];
  assert.equal(landed?.itemCode, "gram-50");
  assert.equal(landed?.title, "50 Gram");
  assert.equal(landed?.rewardType, "gram");
  assert.notEqual(plan.stopIndex, reversed.findIndex((item) => item.itemCode === "gram-50"));
});

test("azc-100 pin is not confused with gram-50 neighbor", () => {
  const winner = { itemCode: "azc-100", title: "100 AZC", rewardType: "azc" as const };
  const plan = pinWinnerOnStrip(CATALOG, winner);
  const offset = rouletteCenterOffsetPx(plan.stopIndex);
  assert.equal(stripIndexUnderCenterPointer(offset), plan.stopIndex);
  assert.equal(plan.strip[plan.stopIndex]?.itemCode, "azc-100");
  assert.equal(plan.strip[plan.stopIndex]?.title, "100 AZC");
  const neighbor = plan.strip[plan.stopIndex + 1];
  assert.ok(neighbor);
  assert.notEqual(neighbor.itemCode, plan.strip[plan.stopIndex]?.itemCode);
});

test("left-aligned stopIndex*stride would land on a different chip", () => {
  const winner = { itemCode: "azc-100", title: "100 AZC", rewardType: "azc" as const };
  const plan = pinWinnerOnStrip(CATALOG, winner);
  const wrongOffset = plan.stopIndex * ROULETTE_STRIDE;
  const viewport = 390;
  const pointerInTrack = wrongOffset + viewport / 2;
  const wrongIndex = Math.floor(pointerInTrack / ROULETTE_STRIDE);
  assert.notEqual(wrongIndex, plan.stopIndex);
  assert.notEqual(plan.strip[wrongIndex]?.itemCode, "azc-100");
});

test("centered offset is viewport-independent", () => {
  const stopIndex = 64;
  const offset = rouletteCenterOffsetPx(stopIndex);
  assert.equal(offset, stopIndex * ROULETTE_STRIDE + ROULETTE_ITEM_WIDTH / 2);
  assert.equal(stripIndexUnderCenterPointer(offset), stopIndex);
});

test("pointer center matches winning chip center for 320–430 viewports", () => {
  const winner = { itemCode: "azc-100", title: "100 AZC", rewardType: "azc" as const };
  const plan = pinWinnerOnStrip(CATALOG, winner);
  const offset = rouletteCenterOffsetPx(plan.stopIndex);
  for (const viewport of [320, 360, 390, 430, 1024]) {
    assert.equal(
      chipCenterX(plan.stopIndex, offset, viewport),
      pointerCenterX(viewport),
    );
  }
  assert.equal(plan.strip[plan.stopIndex]?.itemCode, "azc-100");
  assert.equal(rouletteSpinTransform(offset), `translate3d(-${offset}px, 0, 0)`);
  assert.equal(ROULETTE_STRIDE, ROULETTE_ITEM_WIDTH + ROULETTE_GAP);
  assert.ok(CASE_ROULETTE_ANIMATION_MS >= 5000);
  assert.ok(CASE_ROULETTE_ANIMATION_MS <= 8000);
  assert.ok(CASE_ROULETTE_OPEN_SEQUENCE_MS > CASE_ROULETTE_ANIMATION_MS);
});

test("reversed catalog does not change pinned backend winner", () => {
  const winner = { itemCode: "gram-50", title: "50 Gram", rewardType: "gram" as const };
  const shuffled = [CATALOG[3]!, CATALOG[0]!, winner, CATALOG[2]!];
  const plan = pinWinnerOnStrip(shuffled, winner);
  assert.equal(plan.strip[plan.stopIndex]?.itemCode, "gram-50");
  assert.notEqual(plan.stopIndex, shuffled.findIndex((item) => item.itemCode === "gram-50"));
});
