import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar } from "./Avatar.js";
import { httpsAvatarSrc } from "../lib/https-url.js";

test("Avatar renders img for https URL and initials without URL", () => {
  const withPhoto = renderToStaticMarkup(
    createElement(Avatar, {
      name: "Ada",
      src: "https://cdn.telegram.org/a.jpg",
    }),
  );
  assert.match(withPhoto, /<img/);
  assert.match(withPhoto, /https:\/\/cdn\.telegram\.org\/a\.jpg/);
  assert.doesNotMatch(withPhoto, />A</);

  const initials = renderToStaticMarkup(createElement(Avatar, { name: "Ada" }));
  assert.doesNotMatch(initials, /<img/);
  assert.match(initials, />A</);
});

test("non-https avatar URLs fall back to initials", () => {
  assert.equal(httpsAvatarSrc("javascript:alert(1)"), undefined);
  assert.equal(httpsAvatarSrc("http://cdn.telegram.org/a.jpg"), undefined);
  assert.equal(httpsAvatarSrc("data:image/png;base64,xx"), undefined);
  const html = renderToStaticMarkup(
    createElement(Avatar, { name: "Bo", src: "javascript:alert(1)" }),
  );
  assert.doesNotMatch(html, /<img/);
  assert.match(html, />B</);
});
