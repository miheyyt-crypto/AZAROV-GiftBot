import assert from "node:assert/strict";
import { test } from "node:test";
import { fillAlertTexts } from "./overlay-dom.js";

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
