import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GiveawaysPage } from "../pages/GiveawaysPage.js";
import { GiveawaysView } from "./GiveawaysView.js";
import { formatCountdown, remainingFromEndsAt } from "./messages.js";
import type { GiveawayPublic } from "./types.js";

const SERVER = "2026-09-14T12:00:00.000Z";
const FETCHED = Date.parse(SERVER);

const ACTIVE: GiveawayPublic = {
  id: "g1",
  title: "Premium pack",
  type: "coins",
  status: "active",
  bankAzc: "5000",
  customPrize: null,
  winnerCount: 2,
  actualWinnerCount: null,
  eligibility: "linked_kick",
  endsAt: "2026-09-14T14:00:00.000Z",
  participantCount: 12,
  joined: false,
  eligible: true,
  winners: null,
  serverTime: SERVER,
  imageUrl: null,
};

const JOINED: GiveawayPublic = {
  ...ACTIVE,
  id: "g2",
  joined: true,
};

const NEED_KICK: GiveawayPublic = {
  ...ACTIVE,
  id: "g3",
  eligible: false,
};

const COMPLETED: GiveawayPublic = {
  id: "g4",
  title: "Custom gift",
  type: "custom_prize",
  status: "completed",
  bankAzc: null,
  customPrize: "Telegram Premium",
  winnerCount: 1,
  actualWinnerCount: 1,
  eligibility: "linked_kick",
  endsAt: "2026-09-01T00:00:00.000Z",
  participantCount: 40,
  joined: true,
  eligible: true,
  winners: [
    {
      userId: "u1",
      publicId: "pub-me",
      prizeAzc: null,
      prizeText: "Telegram Premium",
      deliveryStatus: "pending_delivery",
    },
  ],
  serverTime: SERVER,
  imageUrl: null,
};

test("giveaways view lists active cards with join CTA", () => {
  const html = renderToStaticMarkup(
    createElement(GiveawaysView, {
      tab: "active",
      items: [ACTIVE, JOINED, NEED_KICK],
      serverTime: SERVER,
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
      onJoin: () => undefined,
      onLinkKick: () => undefined,
    }),
  );
  assert.match(html, /Premium pack/);
  assert.match(html, /5 000/);
  assert.doesNotMatch(html, /AZC/);
  assert.match(html, /Привязанный Kick/);
  assert.match(html, /Участников: 12/);
  assert.match(html, /Участвовать/);
  assert.match(html, /Вы участвуете/);
  assert.match(html, /Привязать Kick/);
  assert.match(html, /giveaway-joined/);
  assert.doesNotMatch(html, /Claim/i);
});

test("giveaways view empty state", () => {
  const html = renderToStaticMarkup(
    createElement(GiveawaysView, {
      tab: "active",
      items: [],
      serverTime: SERVER,
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
      onShowCompleted: () => undefined,
    }),
  );
  assert.match(html, /Нет активных розыгрышей/);
  assert.match(html, /Загляните в завершённые/);
  assert.match(html, /Посмотреть историю/);
  assert.doesNotMatch(html, /AZC/i);
});

test("completed giveaways empty has no history CTA", () => {
  const html = renderToStaticMarkup(
    createElement(GiveawaysView, {
      tab: "completed",
      items: [],
      serverTime: SERVER,
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
    }),
  );
  assert.match(html, /Нет завершённых розыгрышей/);
  assert.match(html, /появятся здесь/);
  assert.doesNotMatch(html, /Посмотреть историю/);
});

test("completed giveaways highlight viewer winner via publicId", () => {
  const html = renderToStaticMarkup(
    createElement(GiveawaysView, {
      tab: "completed",
      items: [COMPLETED],
      serverTime: SERVER,
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
      viewerPublicId: "pub-me",
    }),
  );
  assert.match(html, /Вы победили/);
  assert.match(html, /data-testid="giveaway-winner-you"/);
  assert.match(html, /Telegram Premium/);
  assert.match(html, /Custom gift/);
  assert.doesNotMatch(html, /AZC/i);
});

test("countdown uses serverTime offset", () => {
  const remaining = remainingFromEndsAt(
    "2026-09-14T12:01:30.000Z",
    SERVER,
    FETCHED,
    FETCHED + 30_000,
  );
  assert.equal(remaining, 60);
  assert.equal(formatCountdown(3661), "01:01:01");
});

test("giveaways page tabs and active empty", () => {
  const html = renderToStaticMarkup(
    createElement(GiveawaysPage, { token: "fixture", skipRemote: true }),
  );
  assert.match(html, />Розыгрыши</);
  assert.match(html, /Активные/);
  assert.match(html, /Завершённые/);
  assert.match(html, /Нет активных розыгрышей/);
  assert.match(html, /Посмотреть историю/);
  assert.doesNotMatch(html, /AZC/i);
});

test("giveaways page completed empty fixture", () => {
  const html = renderToStaticMarkup(
    createElement(GiveawaysPage, {
      token: "fixture",
      skipRemote: true,
      fixtureTab: "completed",
    }),
  );
  assert.match(html, /Нет завершённых розыгрышей/);
  assert.doesNotMatch(html, /Посмотреть историю/);
});

test("giveaways page error retry fixture", () => {
  const html = renderToStaticMarkup(
    createElement(GiveawaysPage, {
      token: "fixture",
      skipRemote: true,
      fixtureStatus: "error",
    }),
  );
  assert.match(html, /Не удалось загрузить/);
  assert.match(html, /Повторить/);
  assert.doesNotMatch(html, /AZC/i);
});

test("giveaways page renders real active fixture without empty copy", () => {
  const html = renderToStaticMarkup(
    createElement(GiveawaysPage, {
      token: "fixture",
      skipRemote: true,
      fixtureItems: [ACTIVE],
    }),
  );
  assert.match(html, /Premium pack/);
  assert.match(html, /Участвовать/);
  assert.doesNotMatch(html, /Нет активных розыгрышей/);
});

test("giveaways view renders imageUrl and falls back without it", () => {
  const withPhoto: GiveawayPublic = {
    ...ACTIVE,
    id: "g-photo",
    imageUrl: "/giveaways/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png",
  };
  const html = renderToStaticMarkup(
    createElement(GiveawaysView, {
      tab: "active",
      items: [withPhoto, ACTIVE],
      serverTime: SERVER,
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
    }),
  );
  assert.match(html, /giveaway-card--photo/);
  assert.match(html, /src="\/giveaways\/media\/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png"/);
  assert.match(html, /Premium pack/);
});

test("null giveaway data does not crash cards", () => {
  const html = renderToStaticMarkup(
    createElement(GiveawaysView, {
      tab: "completed",
      items: [{ ...COMPLETED, winners: null, imageUrl: null }],
      serverTime: SERVER,
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
    }),
  );
  assert.match(html, /Custom gift/);
  assert.doesNotMatch(html, /giveaway-card--photo/);
});

