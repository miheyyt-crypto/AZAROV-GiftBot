import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidTransitionError } from "./errors.js";
import {
  assertTransition,
  canTransition,
  cashItemWithdrawalTransitions,
  gameRoundTransitions,
  giveawayTransitions,
  gramWithdrawalTransitions,
  referralTransitions,
  shopOrderTransitions,
} from "./states.js";

test("referral attribution does not imply activation", () => {
  assert.equal(canTransition(referralTransitions.attributed, "activated"), true);
  assert.equal(
    canTransition(referralTransitions.attributed, "attributed"),
    false,
  );
});

test("async game pending can settle once", () => {
  assert.equal(canTransition(gameRoundTransitions.pending, "settled"), true);
  assert.equal(canTransition(gameRoundTransitions.settled, "settled"), false);
  assert.equal(canTransition(gameRoundTransitions.settled, "pending"), false);
});

test("giveaway cannot settle while open", () => {
  assert.equal(canTransition(giveawayTransitions.open, "settled"), false);
  assert.equal(canTransition(giveawayTransitions.closed, "settled"), true);
});

test("assertTransition rejects illegal moves", () => {
  assert.throws(
    () => assertTransition("giveaway", giveawayTransitions, "open", "settled"),
    InvalidTransitionError,
  );
});

test("shop order terminal states cannot move", () => {
  assert.equal(canTransition(shopOrderTransitions.pending, "processing"), true);
  assert.equal(canTransition(shopOrderTransitions.pending, "fulfilled"), true);
  assert.equal(canTransition(shopOrderTransitions.pending, "rejected"), true);
  assert.equal(canTransition(shopOrderTransitions.processing, "fulfilled"), true);
  assert.equal(canTransition(shopOrderTransitions.processing, "rejected"), true);
  assert.equal(canTransition(shopOrderTransitions.fulfilled, "rejected"), false);
  assert.equal(canTransition(shopOrderTransitions.rejected, "fulfilled"), false);
  assert.equal(canTransition(shopOrderTransitions.fulfilled, "processing"), false);
  assert.throws(
    () =>
      assertTransition("shop_order", shopOrderTransitions, "fulfilled", "rejected"),
    InvalidTransitionError,
  );
});

test("gram withdrawal terminal states cannot move", () => {
  assert.equal(canTransition(gramWithdrawalTransitions.pending, "processing"), true);
  assert.equal(canTransition(gramWithdrawalTransitions.pending, "fulfilled"), true);
  assert.equal(canTransition(gramWithdrawalTransitions.pending, "rejected"), true);
  assert.equal(canTransition(gramWithdrawalTransitions.processing, "fulfilled"), true);
  assert.equal(canTransition(gramWithdrawalTransitions.processing, "rejected"), true);
  assert.equal(canTransition(gramWithdrawalTransitions.fulfilled, "rejected"), false);
  assert.equal(canTransition(gramWithdrawalTransitions.rejected, "fulfilled"), false);
  assert.equal(canTransition(gramWithdrawalTransitions.fulfilled, "processing"), false);
  assert.throws(
    () =>
      assertTransition(
        "gram_withdrawal",
        gramWithdrawalTransitions,
        "fulfilled",
        "rejected",
      ),
    InvalidTransitionError,
  );
});

test("cash item withdrawal terminal states cannot move", () => {
  assert.equal(canTransition(cashItemWithdrawalTransitions.pending, "processing"), true);
  assert.equal(canTransition(cashItemWithdrawalTransitions.pending, "fulfilled"), true);
  assert.equal(canTransition(cashItemWithdrawalTransitions.pending, "rejected"), true);
  assert.equal(canTransition(cashItemWithdrawalTransitions.processing, "fulfilled"), true);
  assert.equal(canTransition(cashItemWithdrawalTransitions.processing, "rejected"), true);
  assert.equal(canTransition(cashItemWithdrawalTransitions.fulfilled, "rejected"), false);
  assert.equal(canTransition(cashItemWithdrawalTransitions.rejected, "fulfilled"), false);
  assert.throws(
    () =>
      assertTransition(
        "cash_withdrawal",
        cashItemWithdrawalTransitions,
        "fulfilled",
        "rejected",
      ),
    InvalidTransitionError,
  );
});
