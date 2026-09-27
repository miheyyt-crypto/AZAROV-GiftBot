import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeWelvuraAdminCallback,
  formatWelvuraAdminCaptionAfterReview,
  parseWelvuraAdminCallback,
  welvuraAdminReviewReplyMarkup,
} from "./welvura-admin-telegram.js";

const SUBMISSION_ID = "786c5799-ccf4-4080-8042-545f1b0ab6ea";

test("welvura admin callback_data stays under Telegram's 64-byte limit", () => {
  const data = encodeWelvuraAdminCallback({
    kind: "account",
    action: "approve",
    submissionId: SUBMISSION_ID,
  });
  assert.equal(data, `wvaa:${SUBMISSION_ID}`);
  assert.ok(Buffer.byteLength(data, "utf8") <= 64);
  assert.deepEqual(parseWelvuraAdminCallback(data), {
    kind: "account",
    action: "approve",
    submissionId: SUBMISSION_ID,
  });
  assert.deepEqual(
    parseWelvuraAdminCallback(
      encodeWelvuraAdminCallback({
        kind: "deposit",
        action: "reject",
        submissionId: SUBMISSION_ID,
      }),
    ),
    {
      kind: "deposit",
      action: "reject",
      submissionId: SUBMISSION_ID,
    },
  );
  assert.equal(parseWelvuraAdminCallback("start"), undefined);
});

test("welvura admin review keyboard has apply and reject", () => {
  const markup = welvuraAdminReviewReplyMarkup("deposit", SUBMISSION_ID);
  assert.equal(markup.inline_keyboard[0]?.[0]?.text, "✅ Применить");
  assert.equal(markup.inline_keyboard[0]?.[1]?.text, "❌ Отклонить");
});

test("reviewed caption replaces pending status", () => {
  const pending = "Статус: ⏳ Ожидает проверки";
  assert.match(
    formatWelvuraAdminCaptionAfterReview(pending, "approve"),
    /Статус: ✅ Подтверждено/,
  );
  assert.match(
    formatWelvuraAdminCaptionAfterReview(pending, "reject"),
    /Статус: ❌ Отклонено/,
  );
});
