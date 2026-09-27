import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BottomNavigation } from "../components/BottomNavigation.js";
import { FriendsPage } from "../pages/FriendsPage.js";
import { FriendsView } from "./FriendsView.js";
import { parseReferralList, parseReferralMe } from "./parse.js";
import {
  EMPTY_REFERRAL_LIST,
  EMPTY_REFERRAL_ME,
  REFERRAL_STEPS,
  type ReferralMeSummary,
} from "./types.js";

const SAMPLE_ME: ReferralMeSummary = {
  referralUrl: "https://t.me/giftbot?start=abc123",
  token: "abc123",
  stats: { invited: 7, active: 5, earnedAzc: "5000" },
  caseProgress: {
    current: 0,
    target: 5,
    availableCases: 1,
    totalCasesEarned: 1,
  },
};

test("parseReferralMe and list", () => {
  const me = parseReferralMe(SAMPLE_ME);
  assert.equal(me.stats.active, 5);
  assert.equal(me.caseProgress.availableCases, 1);
  const list = parseReferralList({
    items: [
      {
        id: "r1",
        status: "activated",
        statusLabel: "Активен",
        username: "friend",
        publicId: null,
        attributedAt: "2026-01-01T00:00:00.000Z",
        activatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    nextCursor: null,
  });
  assert.equal(list.items[0]?.username, "friend");
  assert.equal(list.items[0]?.avatarUrl, null);
});

test("friends page fixture uses empty real defaults and hides AZC", () => {
  const html = renderToStaticMarkup(
    createElement(FriendsPage, { token: "fixture", skipRemote: true }),
  );
  assert.match(html, /Рефералы/);
  assert.match(html, /Как это работает/);
  for (const step of REFERRAL_STEPS) {
    assert.match(html, new RegExp(step));
  }
  assert.match(html, /1 000/);
  assert.match(html, /referral-case\.webp/);
  assert.match(html, /Пригласить друга в Telegram/);
  assert.match(html, /data-testid="referral-copy"/);
  assert.match(html, /0 \/ 5/);
  assert.match(html, /привязки Kick/);
  assert.doesNotMatch(html, /AZC/);
  assert.doesNotMatch(html, /1 391/);
  assert.doesNotMatch(html, /@username/);
  assert.doesNotMatch(html, /Нет кейсов/);
  assert.doesNotMatch(html, /Tower/);
  assert.doesNotMatch(html, /Закрытое сообщество/);
  assert.equal(EMPTY_REFERRAL_ME.stats.invited, 0);
  assert.equal(EMPTY_REFERRAL_ME.caseProgress.availableCases, 0);
});

test("friends view renders API values not screenshot numbers", () => {
  const html = renderToStaticMarkup(
    createElement(FriendsView, {
      me: SAMPLE_ME,
      list: EMPTY_REFERRAL_LIST,
      balanceAzc: "2488",
      copied: false,
      onCopy: () => undefined,
      onShare: () => undefined,
      onOpenCase: () => undefined,
    }),
  );
  assert.match(html, />7</);
  assert.match(html, />5</);
  assert.match(html, /5 000/);
  assert.match(html, /https:\/\/t\.me\/giftbot\?start=abc123/);
  assert.match(html, /0 \/ 5/);
  assert.doesNotMatch(html, /1 391/);
  assert.doesNotMatch(html, /AZC/);
  assert.match(html, /\/assets\/coin-icon\.png/);
});

test("bottom nav order keeps shop in the center with route-derived active", () => {
  const html = renderToStaticMarkup(
    createElement(BottomNavigation, { active: "friends" }),
  );
  assert.match(html, /Главная[\s\S]*Задания[\s\S]*Магазин[\s\S]*Друзья[\s\S]*Профиль/);
  assert.match(html, /data-tab="shop"/);
  assert.match(html, /bottom-nav__item--shop/);
  assert.match(html, /aria-current="page" data-tab="friends"/);
  assert.doesNotMatch(html, /aria-current="page" data-tab="home"/);
  assert.doesNotMatch(html, /bottom-nav__indicator/);
  assert.doesNotMatch(html, /Tower/);

  const shopHtml = renderToStaticMarkup(
    createElement(BottomNavigation, { active: "shop" }),
  );
  assert.match(shopHtml, /aria-current="page" data-tab="shop"/);
  assert.match(shopHtml, /bottom-nav__shop-btn/);
  const shopButton = shopHtml.match(/data-tab="shop"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.doesNotMatch(shopButton, /bottom-nav__indicator/);
});
