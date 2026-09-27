import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRAM_MIN_WITHDRAWAL_MINOR,
  GRAM_MINOR_PER_UNIT,
  canWithdrawGram,
  formatGramMinor,
  gramAvailableMinor,
  gramWithdrawalProgressPercent,
  serializeGramSummary,
} from "./gram.js";

test("Gram serializes 0.016 exactly without float", () => {
  assert.equal(formatGramMinor(16_000_000n), "0.016");
  assert.equal(formatGramMinor(0n), "0");
  assert.equal(formatGramMinor(GRAM_MINOR_PER_UNIT), "1");
  assert.equal(formatGramMinor(GRAM_MINOR_PER_UNIT + 1n), "1.000000001");
  assert.equal(formatGramMinor(23_450_000_000n), "23.45");
  assert.equal(formatGramMinor(GRAM_MIN_WITHDRAWAL_MINOR), "20");
});

test("19.999999999 Gram cannot withdraw and exactly 20 can", () => {
  const justBelow = GRAM_MIN_WITHDRAWAL_MINOR - 1n;
  assert.equal(formatGramMinor(justBelow), "19.999999999");
  assert.equal(canWithdrawGram(justBelow), false);
  assert.equal(canWithdrawGram(GRAM_MIN_WITHDRAWAL_MINOR), true);
});

test("available Gram is total minus reserved using bigint", () => {
  const balance = 25_000_000_000n;
  const reserved = 25_000_000_000n;
  assert.equal(gramAvailableMinor(balance, reserved), 0n);
  assert.equal(gramAvailableMinor(balance, 0n), balance);
  const summary = serializeGramSummary(balance, reserved);
  assert.equal(summary.balance, "25");
  assert.equal(summary.reserved, "25");
  assert.equal(summary.available, "0");
  assert.equal(summary.minimumWithdrawal, "20");
  assert.equal(summary.canWithdraw, false);
});

test("withdrawal progress uses bigint math", () => {
  assert.equal(gramWithdrawalProgressPercent(0n), 0);
  assert.equal(gramWithdrawalProgressPercent(10_000_000_000n), 50);
  assert.equal(gramWithdrawalProgressPercent(GRAM_MIN_WITHDRAWAL_MINOR), 100);
  assert.equal(gramWithdrawalProgressPercent(GRAM_MIN_WITHDRAWAL_MINOR + 1n), 100);
});
