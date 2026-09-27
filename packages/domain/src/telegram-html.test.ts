import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sanitizeTelegramHtml,
  telegramHtmlFitsCaption,
  TELEGRAM_CAPTION_MAX_LENGTH,
} from "./telegram-html.js";

test("telegram html keeps allowed tags and drops script", () => {
  const html = sanitizeTelegramHtml(
    '<b>Hi</b> <script>alert(1)</script> <a href="https://example.com/x">x</a>',
  );
  assert.match(html, /<b>Hi<\/b>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<a href="https:\/\/example.com\/x">x<\/a>/);
});

test("caption fit uses Telegram 1024 limit", () => {
  assert.equal(telegramHtmlFitsCaption("ok"), true);
  assert.equal(
    telegramHtmlFitsCaption("x".repeat(TELEGRAM_CAPTION_MAX_LENGTH + 1)),
    false,
  );
});
