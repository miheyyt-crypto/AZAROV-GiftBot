import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContestHomeBanner } from "./ContestHomeBanner.js";
import { parseContestHomeSummaryResponse } from "./parse.js";
import { remainingFromEndsAt } from "./messages.js";
import type { ReferralContestHomeSummary } from "./types.js";

const SERVER = "2026-09-22T12:00:00.000Z";
const FETCHED = Date.parse(SERVER);

const PAGE: ReferralContestHomeSummary = {
  contest: {
    id: "c1",
    status: "active",
    startAt: "2026-09-21T12:00:00.000Z",
    endAt: "2026-09-23T12:00:00.000Z",
    prizes: [
      { place: 1, rewardAzc: "50000" },
      { place: 2, rewardAzc: "34000" },
      { place: 3, rewardAzc: "30000" },
      { place: 4, rewardAzc: "20000" },
      { place: 5, rewardAzc: "16000" },
    ],
    serverNow: SERVER,
  },
  leaderboard: [
    {
      rank: 1,
      displayName: "One",
      username: "user1",
      avatarUrl: null,
      referralCount: 14,
      isYou: false,
    },
    {
      rank: 2,
      displayName: "Two",
      username: "user2",
      avatarUrl: null,
      referralCount: 11,
      isYou: false,
    },
    {
      rank: 3,
      displayName: "Me",
      username: "meuser",
      avatarUrl: null,
      referralCount: 7,
      isYou: true,
    },
    {
      rank: 4,
      displayName: "Four",
      username: "user4",
      avatarUrl: null,
      referralCount: 5,
      isYou: false,
    },
    {
      rank: 5,
      displayName: "Five",
      username: "user5",
      avatarUrl: null,
      referralCount: 4,
      isYou: false,
    },
  ],
  me: {
    rank: 3,
    referralCount: 7,
    potentialRewardAzc: "30000",
    referralUrl: "https://t.me/AZAROV_GiftBot?start=abc",
  },
  serverNow: SERVER,
};

test("home banner shows prizes, TOP5, own stats and invite without contest page", () => {
  const html = renderToStaticMarkup(
    createElement(ContestHomeBanner, {
      page: PAGE,
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
      onInvite: () => undefined,
    }),
  );
  assert.match(html, /РЕФЕРАЛЬНЫЙ/);
  assert.match(html, /БАТТЛ/);
  assert.match(html, /До конца/);
  assert.match(html, /24:00:00/);
  assert.match(html, /ПРИЗЫ/);
  assert.match(html, /50 000/);
  assert.match(html, /34 000/);
  assert.match(html, /30 000/);
  assert.match(html, /20 000/);
  assert.match(html, /16 000/);
  assert.match(html, /TOP 5/);
  assert.match(html, /Приз от 5 активных рефералов/);
  assert.match(html, /@user1/);
  assert.match(html, /@user5/);
  assert.match(html, /Приглашено/);
  assert.match(html, />7</);
  assert.match(html, /Твоё место/);
  assert.match(html, /#3/);
  assert.match(html, /\(Ты\)/);
  assert.match(html, /Пригласить друзей/);
  assert.doesNotMatch(html, /contest\/referral/);
  assert.doesNotMatch(html, /Участвовать/);
});

test("home banner hides invite after finalize", () => {
  const html = renderToStaticMarkup(
    createElement(ContestHomeBanner, {
      page: {
        ...PAGE,
        contest: PAGE.contest
          ? { ...PAGE.contest, status: "finalized" }
          : null,
      },
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
      onInvite: () => undefined,
    }),
  );
  assert.match(html, /КОНКУРС ЗАВЕРШЁН/);
  assert.match(html, /@user1/);
  assert.doesNotMatch(html, /Пригласить друзей/);
  assert.doesNotMatch(html, /До конца/);
});

test("home banner empty leaderboard stays compact", () => {
  const html = renderToStaticMarkup(
    createElement(ContestHomeBanner, {
      page: { ...PAGE, leaderboard: [] },
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
      onInvite: () => undefined,
    }),
  );
  assert.match(html, /Пока никто не пригласил друзей/);
  assert.match(html, /Стань первым!/);
  assert.match(html, /Приз от 5 активных рефералов/);
  assert.match(html, /Пригласить друзей/);
});

test("home banner rank fallback is a dash when unranked", () => {
  const html = renderToStaticMarkup(
    createElement(ContestHomeBanner, {
      page: {
        ...PAGE,
        me: { ...PAGE.me, rank: 0, referralCount: 0 },
        leaderboard: PAGE.leaderboard.map((row) => ({ ...row, isYou: false })),
      },
      fetchedAtMs: FETCHED,
      nowMs: FETCHED,
      onInvite: () => undefined,
    }),
  );
  assert.match(html, /Твоё место/);
  assert.match(html, />—</);
  assert.doesNotMatch(html, /\(Ты\)/);
});

test("summary parser keeps prizes, leaderboard and referralUrl", () => {
  const parsed = parseContestHomeSummaryResponse(PAGE);
  assert.equal(parsed.contest?.id, "c1");
  assert.equal(parsed.contest?.prizes.length, 5);
  assert.equal(parsed.leaderboard.length, 5);
  assert.equal(parsed.me.referralUrl, "https://t.me/AZAROV_GiftBot?start=abc");
});

test("countdown uses server timestamps", () => {
  const remaining = remainingFromEndsAt(
    "2026-09-22T12:01:00.000Z",
    SERVER,
    FETCHED,
    FETCHED,
  );
  assert.equal(remaining, 60);
});
