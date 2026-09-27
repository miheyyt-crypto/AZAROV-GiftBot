import assert from "node:assert/strict";
import { test } from "node:test";
import { WELVURA_DEPOSIT_STAGES } from "@giftbot/domain";
import {
  CORE_TASK_MAP,
  LIVE_SHOP_PRODUCT_MAP,
  V1_WELVURA_DEPOSIT_LADDER,
  assertWelvuraLaddersMatch,
  lookupV1CaseDrop,
  mapPaidCaseCode,
  referralCaseAvailability,
  canonicalActivatedReferralCount,
  v1LevelRewardAzc,
} from "./mappings.js";

test("all six core task mappings", () => {
  assert.equal(CORE_TASK_MAP["telegram-subscribe"], "telegram_subscribe_azarov222");
  assert.equal(CORE_TASK_MAP["launch-bot"], "telegram_bot_started");
  assert.equal(CORE_TASK_MAP["kick-connect"], "kick_link");
  assert.equal(CORE_TASK_MAP["kick-follow"], "kick_follow_azarov7777");
  assert.equal(CORE_TASK_MAP["kick-nickname"], "kick_nickname_tag");
  assert.equal(CORE_TASK_MAP["referral-invite"], "referral_3_active");
});

test("all 13 Welvura ladder mappings match V2", () => {
  assert.equal(assertWelvuraLaddersMatch(), undefined);
  assert.equal(WELVURA_DEPOSIT_STAGES.length, 13);
  assert.equal(V1_WELVURA_DEPOSIT_LADDER.length, 13);
});

test("rich maps to blatnoy and preserves V1 display chance for known reward", () => {
  assert.equal(mapPaidCaseCode("rich"), "blatnoy");
  const drop = lookupV1CaseDrop("rich", "rich-coins-22222");
  assert.equal(drop?.chance, 47);
  assert.equal(drop?.amount, 22222);
});

test("unknown case reward is not invented", () => {
  assert.equal(lookupV1CaseDrop("rich", "no-such-reward"), undefined);
});

test("legacy shop products are not mapped to unrelated live SKUs", () => {
  assert.equal(LIVE_SHOP_PRODUCT_MAP["tg-premium-12m"]?.v2Code, "premium-12");
  assert.equal(LIVE_SHOP_PRODUCT_MAP["tg-premium-12m"]?.catalog, "disabled");
  assert.equal(LIVE_SHOP_PRODUCT_MAP["diamond-autograph"]?.catalog, "legacy_inactive");
  assert.notEqual(LIVE_SHOP_PRODUCT_MAP["diamond-autograph"]?.v2Code, "donat");
});

test("V1 level reward amount is level * 50", () => {
  assert.equal(v1LevelRewardAzc(2), 100n);
  assert.equal(v1LevelRewardAzc(10), 500n);
});

test("referral-case availability uses activated count including manual credits", () => {
  assert.equal(canonicalActivatedReferralCount(0, 25), 25);
  const stats = referralCaseAvailability(25, 5);
  assert.equal(stats.earned, 5);
  assert.equal(stats.consumed, 5);
  assert.equal(stats.available, 0);
});
