import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomePage } from "../pages/HomePage.js";
import { BossesSoonCard, LeaderboardList, LeaderboardPage } from "../pages/LeaderboardPage.js";
import { listAndPin, podiumSlots } from "./leaderboard-ui.js";
import {
  parseBalanceLeaderboard,
  parseReferralLeaderboard,
} from "./parse.js";
import { homePodiumSlots } from "./home-podium.js";
import type { BalanceLeaderboardEntry } from "./types.js";

test("parse balance leaderboard omits private fields", () => {
  const parsed = parseBalanceLeaderboard({
    items: [
      {
        rank: 1,
        publicId: "pub-1",
        displayName: "Top",
        username: "top",
        balanceAzc: "199999",
        isYou: true,
      },
    ],
    self: {
      rank: 1,
      publicId: "pub-1",
      displayName: "Top",
      username: "top",
      balanceAzc: "199999",
      isYou: true,
    },
    serverTime: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(parsed.items[0]?.balanceAzc, "199999");
  assert.equal(parsed.self?.isYou, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(parsed.items[0], "userId"),
    false,
  );
});

test("parse referral leaderboard", () => {
  const parsed = parseReferralLeaderboard({
    items: [
      {
        rank: 1,
        username: "top",
        displayName: "Top",
        publicId: "p1",
        activeReferrals: 12,
        isYou: true,
      },
    ],
    self: {
      rank: 1,
      username: "top",
      displayName: "Top",
      publicId: "p1",
      activeReferrals: 12,
      isYou: true,
    },
  });
  assert.equal(parsed.items[0]?.activeReferrals, 12);
  assert.equal(parsed.self?.isYou, true);
});

test("leaderboard bosses tab shows soon state", () => {
  const html = renderToStaticMarkup(
    createElement(LeaderboardPage, { token: "fixture", skipRemote: true }),
  );
  assert.match(html, /Лидерборд/);
  assert.match(html, /БАЛАНС/);
  assert.match(html, /РЕФЕРАЛ/);
  assert.match(html, /БОССОВ/);
  assert.doesNotMatch(html, /AZC/i);
  const boss = renderToStaticMarkup(
    createElement(LeaderboardPage, {
      token: "fixture",
      skipRemote: true,
      initialTab: "boss",
    }),
  );
  assert.match(boss, /СКОРО\.\.\./);
  assert.doesNotMatch(boss, /Рейтинг боссов появится/);
  assert.doesNotMatch(boss, /AZC/i);
  const soon = renderToStaticMarkup(createElement(BossesSoonCard));
  assert.match(soon, /lb-soon/);
  assert.match(soon, /СКОРО\.\.\./);
});

test("balance list uses 2-1-3 podium and pins self outside top-3", () => {
  const ranks = [
    { place: 1, username: "8ритва", valueLabel: "159258", valueKind: "azc" as const, isYou: false },
    { place: 2, username: "#l3mo_werpa0", valueLabel: "71331", valueKind: "azc" as const, isYou: false },
    { place: 3, username: "Bushman", valueLabel: "27225", valueKind: "azc" as const, isYou: false },
    { place: 4, username: "azarov spiki", valueLabel: "11353", valueKind: "azc" as const, isYou: false },
    { place: 11, username: "Viewer", valueLabel: "4391", valueKind: "azc" as const, isYou: true },
  ];
  const slots = podiumSlots(ranks);
  assert.equal(slots.first?.username, "8ритва");
  assert.equal(slots.second?.username, "#l3mo_werpa0");
  assert.equal(slots.third?.username, "Bushman");
  const { rest, pin } = listAndPin(ranks, ranks[4]);
  assert.equal(pin?.place, 11);
  assert.equal(rest.some((row) => row.place === 11), false);
  const html = renderToStaticMarkup(
    createElement(LeaderboardList, { ranks, self: ranks[4] }),
  );
  const firstName = html.indexOf("8ритва");
  const secondName = html.indexOf("#l3mo_werpa0");
  const thirdName = html.indexOf("Bushman");
  assert.ok(secondName < firstName && firstName < thirdName);
  assert.match(html, /leaderboard-self-pinned/);
  assert.match(html, />Ты</);
  assert.match(html, /159 258/);
  assert.doesNotMatch(html, /AZC/i);
});

test("self in top-3 is not duplicated as a pinned row", () => {
  const ranks = [
    { place: 1, username: "You", valueLabel: "10", valueKind: "azc" as const, isYou: true },
    { place: 2, username: "B", valueLabel: "9", valueKind: "azc" as const, isYou: false },
  ];
  const html = renderToStaticMarkup(
    createElement(LeaderboardList, { ranks, self: ranks[0] }),
  );
  assert.doesNotMatch(html, /leaderboard-self-pinned/);
  assert.match(html, /You/);
  const empty = renderToStaticMarkup(
    createElement(LeaderboardList, { ranks: [], self: undefined }),
  );
  assert.match(empty, /lb-podium__slot--1 is-empty/);
  assert.match(empty, /—/);
});

test("referral list uses friends metric without AZC", () => {
  const ranks = [
    { place: 1, username: "Xot1x", valueLabel: "19", valueKind: "friends" as const, isYou: false },
    { place: 2, username: "8ритва", valueLabel: "16", valueKind: "friends" as const, isYou: false },
    { place: 3, username: "sharlotka", valueLabel: "14", valueKind: "friends" as const, isYou: false },
    { place: 14, username: "Viewer", valueLabel: "1", valueKind: "friends" as const, isYou: true },
  ];
  const html = renderToStaticMarkup(
    createElement(LeaderboardList, { ranks, self: ranks[3] }),
  );
  assert.match(html, /Xot1x/);
  assert.match(html, /lb-friends/);
  assert.match(html, /leaderboard-self-pinned/);
  assert.doesNotMatch(html, /AZC/i);
});

test("home fixture keeps approved section order", () => {
  const html = renderToStaticMarkup(
    createElement(HomePage, { token: "fixture", skipRemote: true }),
  );
  const rolls = html.indexOf("ROLLS");
  const mines = html.indexOf("MINES");
  const dice = html.indexOf("DICE");
  const giveaways = html.indexOf("Розыгрыши");
  const top = html.indexOf("Топ лудиков");
  const recent = html.indexOf("Только что выпало");
  assert.ok(rolls >= 0 && mines >= 0 && dice >= 0);
  assert.ok(giveaways >= 0 && top >= 0 && recent >= 0);
  assert.ok(Math.max(mines, dice) < giveaways);
  assert.ok(giveaways < top);
  assert.ok(top < recent);
  assert.doesNotMatch(html, /Закрытое сообщество/);
  assert.doesNotMatch(html, /drop-grid/);
  assert.match(html, /home-page/);
  assert.match(html, /recent-wins/);
  const homeSrc = readFileSync(join(process.cwd(), "src/pages/HomePage.tsx"), "utf8");
  assert.match(homeSrc, /className="drop-row"/);
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  assert.match(css, /\.drop-row\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.home-page > \*\s*\{[^}]*min-width:\s*0/s);
  assert.match(html, /game-card--rolls/);
  assert.match(html, /game-card--mines/);
  assert.match(html, /game-card--dice/);
  assert.match(html, /game-banners__row/);
  assert.match(html, /mines-banner\.webp/);
  assert.match(html, /dice-banner\.webp/);
  assert.match(html, /rolls-banner\.webp/);
  assert.match(html, /identity-header/);
  assert.ok(html.indexOf("identity-header") < html.indexOf("БЕСПЛАТНЫЙ КЕЙС"));
  assert.match(html, /БЕСПЛАТНЫЙ КЕЙС/);
  assert.match(html, /Что внутри/);
  assert.doesNotMatch(html, /AZC/);
  assert.match(html, /Нет активных розыгрышей/);
  assert.match(html, /Пока нет недавних выигрышей|Пока пусто/);
  assert.doesNotMatch(html, /Заморозки/);
});

function entry(rank: number, name: string): BalanceLeaderboardEntry {
  return {
    rank,
    publicId: `pub-${String(rank)}`,
    displayName: name,
    username: name.toLowerCase(),
    avatarUrl: null,
    balanceAzc: "10",
    isYou: false,
  };
}

test("home podium slots follow real ranks, not visual 2-1-3 fill order", () => {
  const none = homePodiumSlots([]);
  assert.equal(none.first, undefined);
  assert.equal(none.second, undefined);
  assert.equal(none.third, undefined);

  const one = homePodiumSlots([entry(1, "Dev")]);
  assert.equal(one.first?.displayName, "Dev");
  assert.equal(one.second, undefined);
  assert.equal(one.third, undefined);

  const two = homePodiumSlots([entry(1, "A"), entry(2, "B")]);
  assert.equal(two.first?.displayName, "A");
  assert.equal(two.second?.displayName, "B");
  assert.equal(two.third, undefined);

  const three = homePodiumSlots([entry(1, "A"), entry(2, "B"), entry(3, "C")]);
  assert.equal(three.first?.displayName, "A");
  assert.equal(three.second?.displayName, "B");
  assert.equal(three.third?.displayName, "C");
});
