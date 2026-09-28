import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hrefFor, parseHash } from "../app/routes.js";
import { parseGiveawayPublic } from "../giveaways/parse.js";
import { AdminCashWithdrawalsPage } from "../pages/AdminCashWithdrawalsPage.js";
import { AdminGiveawaysPage } from "../pages/AdminGiveawaysPage.js";
import { AdminGramWithdrawalsPage } from "../pages/AdminGramWithdrawalsPage.js";
import { AdminPromoPage } from "../pages/AdminPromoPage.js";
import { AdminShopOrdersPage } from "../pages/AdminShopOrdersPage.js";
import { AdminWelvuraPage } from "../pages/AdminWelvuraPage.js";
import { AdminBroadcastPage } from "../pages/AdminBroadcastPage.js";
import { AdminShell } from "./AdminShell.js";
import { ADMIN_NAV, adminRouteFromHref } from "./nav.js";

test("admin nav lists only real sections", () => {
  assert.deepEqual(
    ADMIN_NAV.map((item) => item.route),
    [
      "admin-giveaways",
      "admin-welvura",
      "admin-shop-orders",
      "admin-cash-withdrawals",
      "admin-gram-withdrawals",
      "admin-promo-codes",
      "admin-broadcast",
    ],
  );
});

test("admin nav hrefs resolve to matching routes", () => {
  for (const item of ADMIN_NAV) {
    assert.equal(parseHash(item.href).name, item.route);
    assert.equal(adminRouteFromHref(item.href), item.route);
  }
  assert.equal(parseHash("#/admin/giveaways").name, "admin-giveaways");
  assert.notEqual(parseHash("#/admin/giveaways").name, "admin-promo-codes");
  assert.equal(hrefFor({ name: "admin-giveaways" }), "#/admin/giveaways");
  assert.equal(hrefFor({ name: "admin-promo-codes" }), "#/admin/promo-codes");
  assert.equal(hrefFor({ name: "admin-welvura" }), "#/admin/welvura");
  assert.equal(hrefFor({ name: "admin-shop-orders" }), "#/admin/shop/orders");
  assert.equal(hrefFor({ name: "admin-cash-withdrawals" }), "#/admin/cash-withdrawals");
  assert.equal(hrefFor({ name: "admin-gram-withdrawals" }), "#/admin/gram-withdrawals");
});

test("admin shell renders existing nav labels", () => {
  const html = renderToStaticMarkup(createElement(AdminShell, null, "body"));
  assert.match(html, /ADMIN/);
  assert.match(html, /Розыгрыши/);
  assert.match(html, /Welvura/);
  assert.match(html, /Промокоды/);
  assert.match(html, /Рассылка/);
  assert.match(html, /data-testid="admin-nav-admin-giveaways"/);
  assert.match(html, /href="#\/admin\/giveaways"/);
  assert.doesNotMatch(html, /Обзор/);
});

test("Giveaways nav opens giveaway page, not promo", () => {
  const giveaways = renderToStaticMarkup(
    createElement(AdminGiveawaysPage, { skipRemote: true, isSuperAdmin: true }),
  );
  const promo = renderToStaticMarkup(
    createElement(AdminPromoPage, { skipRemote: true, isSuperAdmin: true }),
  );
  assert.match(giveaways, /Розыгрыши/);
  assert.match(giveaways, /Создать розыгрыш/);
  assert.doesNotMatch(giveaways, /Новый промокод/);
  assert.match(promo, /Промокоды/);
  assert.match(promo, /Новый промокод/);
  assert.doesNotMatch(promo, /Создать розыгрыш/);
});

test("each admin page renders its own title", () => {
  const pages = [
    [
      renderToStaticMarkup(
        createElement(AdminGiveawaysPage, { skipRemote: true, isSuperAdmin: true }),
      ),
      "Розыгрыши",
    ],
    [
      renderToStaticMarkup(
        createElement(AdminWelvuraPage, { skipRemote: true, isSuperAdmin: true }),
      ),
      "Welvura",
    ],
    [
      renderToStaticMarkup(
        createElement(AdminShopOrdersPage, { skipRemote: true, isSuperAdmin: true }),
      ),
      "Магазин / Заказы",
    ],
    [
      renderToStaticMarkup(
        createElement(AdminCashWithdrawalsPage, { skipRemote: true, isSuperAdmin: true }),
      ),
      "Выводы ₽",
    ],
    [
      renderToStaticMarkup(
        createElement(AdminGramWithdrawalsPage, { skipRemote: true, isSuperAdmin: true }),
      ),
      "Выводы Gram",
    ],
    [
      renderToStaticMarkup(
        createElement(AdminPromoPage, { skipRemote: true, isSuperAdmin: true }),
      ),
      "Промокоды",
    ],
    [
      renderToStaticMarkup(
        createElement(AdminBroadcastPage, { skipRemote: true, isSuperAdmin: true }),
      ),
      "Рассылка в Telegram",
    ],
  ] as const;
  for (const [html, title] of pages) {
    assert.match(html, new RegExp(`<h1>${title}</h1>`));
  }
});

test("public giveaway parser treats missing imageUrl as null", () => {
  const parsed = parseGiveawayPublic({
    id: "g1",
    title: "t",
    type: "coins",
    status: "active",
    bankAzc: "1",
    customPrize: null,
    winnerCount: 1,
    actualWinnerCount: null,
    eligibility: "linked_kick",
    endsAt: null,
    participantCount: 0,
    joined: false,
    eligible: true,
    winners: null,
    serverTime: "2026-09-14T12:00:00.000Z",
  });
  assert.equal(parsed.imageUrl, null);
});


test("public giveaway parser treats missing imageUrl as null", () => {
  const parsed = parseGiveawayPublic({
    id: "g1",
    title: "t",
    type: "coins",
    status: "active",
    bankAzc: "1",
    customPrize: null,
    winnerCount: 1,
    actualWinnerCount: null,
    eligibility: "linked_kick",
    endsAt: null,
    participantCount: 0,
    joined: false,
    eligible: true,
    winners: null,
    serverTime: "2026-09-14T12:00:00.000Z",
  });
  assert.equal(parsed.imageUrl, null);
});
