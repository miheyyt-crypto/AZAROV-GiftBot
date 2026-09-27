import assert from "node:assert/strict";
import { test } from "node:test";
import { hrefFor, isMainTab, parseHash, showsBottomNav, tabFor } from "./routes.js";

test("parseHash maps the five main tabs", () => {
  assert.deepEqual(parseHash(""), { name: "home" });
  assert.deepEqual(parseHash("#/"), { name: "home" });
  assert.deepEqual(parseHash("#/tasks"), { name: "tasks" });
  assert.deepEqual(parseHash("#/shop"), { name: "shop" });
  assert.deepEqual(parseHash("#/shop/cases"), { name: "shop" });
  assert.deepEqual(parseHash("#/friends"), { name: "friends" });
  assert.deepEqual(parseHash("#/profile"), { name: "profile" });
});

test("parseHash maps nested Mini App screens", () => {
  assert.deepEqual(parseHash("#/tasks/welvura"), { name: "welvura" });
  assert.deepEqual(parseHash("#/shop/orders"), { name: "shop-orders" });
  assert.deepEqual(parseHash("#/profile/orders"), { name: "shop-orders" });
  assert.deepEqual(parseHash("#/profile/notifications"), { name: "notifications" });
  assert.deepEqual(parseHash("#/profile/history"), { name: "coin-history" });
  assert.deepEqual(parseHash("#/profile/operations"), { name: "operations" });
  assert.deepEqual(parseHash("#/profile/inventory"), { name: "inventory" });
  assert.deepEqual(parseHash("#/profile/inventory/withdrawals"), {
    name: "cash-withdrawals",
  });
  assert.deepEqual(parseHash("#/profile/achievements"), { name: "achievements" });
  assert.deepEqual(parseHash("#/giveaways"), { name: "giveaways" });
  assert.deepEqual(parseHash("#/games/rolls"), { name: "game", slug: "rolls" });
  assert.deepEqual(parseHash("#/games/mines"), { name: "game", slug: "mines" });
  assert.deepEqual(parseHash("#/mines"), { name: "game", slug: "mines" });
  assert.deepEqual(parseHash("#/games/dice"), { name: "game", slug: "dice" });
  assert.deepEqual(parseHash("#/dice"), { name: "game", slug: "dice" });
  assert.deepEqual(parseHash("#/leaderboard"), { name: "leaderboard" });
  assert.deepEqual(parseHash("#/admin/promo-codes"), { name: "admin-promo-codes" });
  assert.deepEqual(parseHash("#/admin/giveaways"), { name: "admin-giveaways" });
  assert.notEqual(parseHash("#/admin/giveaways").name, "admin-promo-codes");
  assert.deepEqual(parseHash("#/profile/gram"), { name: "gram-withdrawals" });
  assert.deepEqual(parseHash("#/admin/gram-withdrawals"), {
    name: "admin-gram-withdrawals",
  });
  assert.deepEqual(parseHash("#/admin/shop/orders"), {
    name: "admin-shop-orders",
  });
  assert.deepEqual(parseHash("#/admin/cash-withdrawals"), {
    name: "admin-cash-withdrawals",
  });
  assert.deepEqual(parseHash("#/admin/welvura"), { name: "admin-welvura" });
  assert.deepEqual(parseHash("#/admin/broadcast"), { name: "admin-broadcast" });
  assert.deepEqual(parseHash("#/contest/referral"), { name: "contest-referral" });
  assert.deepEqual(parseHash("#/admin/contest/referral"), {
    name: "admin-contest-referral",
  });
});

test("unknown hashes fall back to home and do not invent extra tabs", () => {
  assert.deepEqual(parseHash("#/admin"), { name: "home" });
  assert.deepEqual(parseHash("#/games"), { name: "home" });
  assert.deepEqual(parseHash("#/inventory"), { name: "home" });
  assert.equal(hrefFor({ name: "home" }), "#/");
  assert.equal(tabFor({ name: "welvura" }), "tasks");
  assert.equal(tabFor({ name: "game", slug: "rolls" }), "home");
  assert.equal(tabFor({ name: "giveaways" }), "home");
  assert.equal(hrefFor({ name: "giveaways" }), "#/giveaways");
  assert.equal(hrefFor({ name: "contest-referral" }), "#/contest/referral");
  assert.equal(tabFor({ name: "contest-referral" }), "home");
  assert.equal(showsBottomNav({ name: "contest-referral" }), true);
  assert.equal(hrefFor({ name: "admin-giveaways" }), "#/admin/giveaways");
  assert.equal(isMainTab({ name: "home" }), true);
  assert.equal(isMainTab({ name: "leaderboard" }), false);
  assert.equal(showsBottomNav({ name: "leaderboard" }), true);
  assert.equal(showsBottomNav({ name: "game", slug: "rolls" }), true);
  assert.equal(showsBottomNav({ name: "welvura" }), false);
  assert.equal(showsBottomNav({ name: "shop-orders" }), true);
  assert.equal(showsBottomNav({ name: "cash-withdrawals" }), true);
  assert.equal(showsBottomNav({ name: "notifications" }), true);
  assert.equal(tabFor({ name: "notifications" }), "profile");
  assert.equal(showsBottomNav({ name: "operations" }), true);
  assert.equal(tabFor({ name: "operations" }), "profile");
  assert.equal(hrefFor({ name: "operations" }), "#/profile/operations");
});

