import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readDevRoleFromSearch } from "./dev-role.js";

test("readDevRoleFromSearch maps query values", () => {
  assert.equal(readDevRoleFromSearch("?dev=user"), "user");
  assert.equal(readDevRoleFromSearch("?dev=admin"), "admin");
  assert.equal(readDevRoleFromSearch("?dev=1"), undefined);
  assert.equal(readDevRoleFromSearch("?dev=true"), undefined);
  assert.equal(readDevRoleFromSearch("?dev=foo"), undefined);
  assert.equal(readDevRoleFromSearch("?dev=superadmin"), undefined);
  assert.equal(readDevRoleFromSearch("?dev=123"), undefined);
  assert.equal(readDevRoleFromSearch("?fixture=shell"), undefined);
  assert.equal(readDevRoleFromSearch(""), undefined);
});

test("needs_telegram gate copy stays for non-dev boot", () => {
  const html = renderToStaticMarkup(
    createElement(
      "section",
      { className: "gate" },
      createElement("h1", null, "GiftBot"),
      createElement("p", null, "Open this Mini App from Telegram."),
    ),
  );
  assert.match(html, /Open this Mini App from Telegram/);
});

test("dev badge labels for user and admin", () => {
  const user = renderToStaticMarkup(
    createElement("div", { className: "dev-badge", "data-testid": "dev-badge" }, "LOCAL DEV"),
  );
  const admin = renderToStaticMarkup(
    createElement(
      "div",
      { className: "dev-badge", "data-testid": "dev-badge" },
      "LOCAL DEV · ADMIN",
    ),
  );
  assert.match(user, /LOCAL DEV/);
  assert.doesNotMatch(user, /ADMIN/);
  assert.match(admin, /LOCAL DEV · ADMIN/);
});
