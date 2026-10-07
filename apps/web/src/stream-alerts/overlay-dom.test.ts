import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DONATION_ALERT_AUDIO_SRC,
  fillAlertTexts,
} from "./overlay-dom.js";

test("overlay ding uses the applepay asset", () => {
  assert.equal(DONATION_ALERT_AUDIO_SRC, "/assets/applepay.mp3");
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../public/assets/applepay.mp3",
  );
  const bytes = readFileSync(file);
  assert.equal(bytes.length, 23_240);
  assert.equal(bytes.subarray(0, 3).toString("ascii"), "ID3");
});

test("XSS payload is assigned as textContent only", () => {
  const nameEl = { textContent: "", innerHTML: "<b>stale</b>" };
  const messageEl = { textContent: "", innerHTML: "<i>stale</i>" };
  fillAlertTexts(
    nameEl as HTMLElement,
    messageEl as HTMLElement,
    {
      displayName: "<img src=x onerror=alert(1)>",
      message: "<script>alert(1)</script>",
    },
  );
  assert.equal(nameEl.textContent, "<img src=x onerror=alert(1)>");
  assert.equal(messageEl.textContent, "<script>alert(1)</script>");
});
