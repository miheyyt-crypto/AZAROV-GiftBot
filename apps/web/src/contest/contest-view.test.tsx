import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContestHomeBanner } from "./ContestHomeBanner.js";
import { ContestReferralView } from "./ContestReferralView.js";
import { parseContestHomeSummaryResponse, parseContestPage } from "./parse.js";
import { formatCountdown, remainingFromEndsAt } from "./messages.js";
import type { ReferralContestPage } from "./types.js";

const SERVER = "2026-09-22T12:00:00.000Z";
const FETCHED = Date.parse(SERVER);

const PAGE: ReferralContestPage = {
  contest: {
    id: "c1",
    status: "active",
    title: "РЕФЕРАЛЬНЫЙ БАТТЛ",
    startAt: "2026-09-21T12:00:00.000Z",
    endAt: "2026-09-23T12:00:00.000Z",
    prizePoolAzc: "100000",
    prizePlaces: 10,
    prizes: [
      { place: 1, rewardAzc: "25000" },
      { place: 2, rewardAzc: "17000" },
      { place: 3, rewardAzc: "15000" },
      { place: 4, rewardAzc: "10000" },
      { place: 5, rewardAzc: "8000" },
      { place: 6, rewardAzc: "7000" },
      { place: 7, rewardAzc: "6000" },
      { place: 8, rewardAzc: "5000" },
      { place: 9, rewardAzc: "4000" },
      { place: 10, rewardAzc: "3000" },
    ],
    finalizedAt: null,
  },
  leaderboard: [
    {
      rank: 1,
      publicId: "p1",
      displayName: "One",
      username: "user1",
      avatarUrl: null,
      referralCount: 34,
      prizePlace: 1,
      rewardAzc: "25000",
      isYou: false,
    },
    {
      rank: 7,
      publicId: "me",
      displayName: "Me",
      username: "meuser",
      avatarUrl: null,
      referralCount: 12,
      prizePlace: 7,
      rewardAzc: "6000",
      isYou: true,
    },
  ],
  me: {
    rank: 7,
    referralCount: 12,
    nextRankGap: 2,
    prizePlace: 7,
    potentialRewardAzc: "6000",
    referralUrl: "https://t.me/AZAROV_GiftBot?start=abc",
  },
  serverNow: SERVER,
};

test("contest page shows pool, prizes, board and my position", () => {
  const html = renderToStaticMarkup(
    createElement(ContestReferralView, {
      page: PAGE,
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
      onInvite: () => undefined,
    }),
  );
  assert.match(html, /100 000/);
  assert.match(html, /1 место/);
  assert.match(html, /10 место/);
  assert.match(html, /@user1/);
  assert.match(html, /Твоя позиция/);
  assert.match(html, /#7/);
  assert.match(html, /7 место · потенциальная награда 6000 AZC/);
  assert.match(html, /Пригласить друзей/);
});

test("home banner is summary-only and links to contest", () => {
  const html = renderToStaticMarkup(
    createElement(ContestHomeBanner, {
      contest: {
        id: "c1",
        status: "active",
        title: "РЕФЕРАЛЬНЫЙ БАТТЛ",
        startAt: PAGE.contest!.startAt,
        endAt: PAGE.contest!.endAt,
        prizePoolAzc: "100000",
        prizePlaces: 10,
        serverNow: SERVER,
      },
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
    }),
  );
  assert.match(html, /РЕФЕРАЛЬНЫЙ БАТТЛ/);
  assert.match(html, /10 ПРИЗОВЫХ МЕСТ/);
  assert.match(html, /Участвовать/);
  assert.doesNotMatch(html, /@user1/);
});

test("summary parser rejects leaderboard-shaped payloads without required fields", () => {
  const parsed = parseContestHomeSummaryResponse({
    contest: {
      id: "c1",
      status: "active",
      title: "t",
      startAt: SERVER,
      endAt: SERVER,
      prizePoolAzc: "100000",
      prizePlaces: 10,
      serverNow: SERVER,
    },
  });
  assert.equal(parsed.contest?.id, "c1");
  assert.equal("leaderboard" in (parsed.contest ?? {}), false);
});

test("page parser keeps referralUrl for existing share flow", () => {
  const parsed = parseContestPage(PAGE);
  assert.equal(parsed.me?.referralUrl, "https://t.me/AZAROV_GiftBot?start=abc");
});

test("countdown uses server timestamps", () => {
  assert.equal(formatCountdown(3661), "01:01:01");
  assert.equal(
    remainingFromEndsAt(
      "2026-09-22T13:00:00.000Z",
      SERVER,
      FETCHED,
      FETCHED,
    ),
    3600,
  );
});
