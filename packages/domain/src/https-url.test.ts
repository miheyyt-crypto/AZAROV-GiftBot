import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeHttpsAvatarUrl } from "./https-url.js";

test("accepts https avatar URLs and trims", () => {
  assert.equal(
    normalizeHttpsAvatarUrl("  https://cdn.telegram.org/file.jpg  "),
    "https://cdn.telegram.org/file.jpg",
  );
});

test("rejects non-https and oversized values", () => {
  assert.equal(normalizeHttpsAvatarUrl("http://cdn.telegram.org/file.jpg"), null);
  assert.equal(normalizeHttpsAvatarUrl("javascript:alert(1)"), null);
  assert.equal(normalizeHttpsAvatarUrl("data:image/png;base64,aaaa"), null);
  assert.equal(normalizeHttpsAvatarUrl("file:///etc/passwd"), null);
  assert.equal(normalizeHttpsAvatarUrl("https://user:pass@cdn.example/a.png"), null);
  assert.equal(normalizeHttpsAvatarUrl(`https://x.test/${"a".repeat(3000)}`), null);
  assert.equal(normalizeHttpsAvatarUrl(""), null);
  assert.equal(normalizeHttpsAvatarUrl(null), null);
});
