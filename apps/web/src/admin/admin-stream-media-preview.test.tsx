import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { AdminStreamMediaPreview } from "./AdminStreamMediaPreview.js";

test("admin video preview stays muted until listen is clicked", () => {
  const html = renderToStaticMarkup(
    createElement(AdminStreamMediaPreview, {
      src: "blob:video",
      contentType: "video/mp4",
      submissionId: "sub-1",
    }),
  );
  assert.match(html, /muted=""/);
  assert.match(html, /Прослушать/);
  assert.match(html, /data-listen-preview="sub-1"/);
  assert.equal(html.includes("autoplay"), false);
});

test("admin image preview has no listen control", () => {
  const html = renderToStaticMarkup(
    createElement(AdminStreamMediaPreview, {
      src: "blob:image",
      contentType: "image/gif",
    }),
  );
  assert.equal(html.includes("Прослушать"), false);
  assert.match(html, /<img/);
});
