import assert from "node:assert/strict";
import { test } from "node:test";
import { formatGramMinor } from "@giftbot/domain";
import { gramMinorFromUnknown } from "./gram.js";

test("exact gram decimal to 1e9 minor including 0.005 and 0.51", () => {
  const a = gramMinorFromUnknown("0.51");
  assert.equal(a.ok, true);
  if (a.ok) {
    assert.equal(a.minor, 510_000_000n);
    assert.equal(a.canonical, "0.51");
    assert.equal(formatGramMinor(a.minor), "0.51");
  }
  const b = gramMinorFromUnknown("0.005");
  assert.equal(b.ok, true);
  if (b.ok) {
    assert.equal(b.minor, 5_000_000n);
  }
  const c = gramMinorFromUnknown("0.001");
  assert.equal(c.ok, true);
  if (c.ok) {
    assert.equal(c.minor, 1_000_000n);
  }
});

test("gram rejects scale beyond 9 with leftover digits", () => {
  const bad = gramMinorFromUnknown("0.0000000001");
  assert.equal(bad.ok, false);
});
