import assert from "node:assert/strict";
import { test } from "node:test";
import { parseManualReferralCreditArgs } from "./credit.js";

test("CLI defaults to dry-run and requires explicit apply flags", () => {
  const parsed = parseManualReferralCreditArgs([
    "node",
    "main.js",
    "--username",
    "alldepww",
    "--amount",
    "25",
  ]);
  assert.equal(parsed.username, "alldepww");
  assert.equal(parsed.amount, 25);
  assert.equal(parsed.apply, false);
  assert.equal(parsed.confirmApply, false);
});

test("apply flags parse idempotency key", () => {
  const parsed = parseManualReferralCreditArgs([
    "--username",
    "@alldepww",
    "--amount",
    "25",
    "--apply",
    "--confirm-apply",
    "--idempotency-key",
    "manual-referral:alldepww:2026-09-20:+25",
  ]);
  assert.equal(parsed.username, "alldepww");
  assert.equal(parsed.apply, true);
  assert.equal(parsed.confirmApply, true);
  assert.equal(parsed.idempotencyKey, "manual-referral:alldepww:2026-09-20:+25");
});
