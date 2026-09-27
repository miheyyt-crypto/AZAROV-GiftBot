import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AchievementsView } from "./AchievementsView.js";
import type { AchievementListItem } from "./types.js";

const ITEMS: AchievementListItem[] = [
  {
    code: "kick_100_messages",
    title: "Первые шаги",
    description: "Напиши 100 сообщений в чате Kick во время стримов",
    emoji: "💬",
    rewardAzc: "500",
    current: 40,
    target: 100,
    progress: 0.4,
    completed: false,
    unlockedAt: null,
  },
  {
    code: "referrals_5_active",
    title: "Своя компания",
    description: "Пригласи 5 активных друзей",
    emoji: "👥",
    rewardAzc: "2500",
    current: 5,
    target: 5,
    progress: 1,
    completed: true,
    unlockedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    code: "games_100_total",
    title: "Игрок",
    description: "Сыграй 100 игр",
    emoji: "🎮",
    rewardAzc: "3000",
    current: 10,
    target: 100,
    progress: 0.1,
    completed: false,
    unlockedAt: null,
  },
  {
    code: "cases_25_opened",
    title: "Любитель кейсов",
    description: "Открой 25 кейсов",
    emoji: "🎁",
    rewardAzc: "5000",
    current: 0,
    target: 25,
    progress: 0,
    completed: false,
    unlockedAt: null,
  },
  {
    code: "level_10",
    title: "Преданный зритель",
    description: "Достигни 10 уровня",
    emoji: "⭐",
    rewardAzc: "10000",
    current: 4,
    target: 10,
    progress: 0.4,
    completed: false,
    unlockedAt: null,
  },
];

test("achievements view renders five cards with rewards and no Claim", () => {
  const html = renderToStaticMarkup(createElement(AchievementsView, { items: ITEMS }));
  assert.equal((html.match(/data-testid="achievement-card"/g) ?? []).length, 5);
  assert.match(html, /Первые шаги/);
  assert.match(html, /500/);
  assert.match(html, /2 500/);
  assert.match(html, /10 000/);
  assert.doesNotMatch(html, /AZC/);
  assert.match(html, /Награда получена/);
  assert.doesNotMatch(html, /Забрать/);
  assert.match(html, /role="progressbar"/);
  assert.doesNotMatch(html, /Claim/i);
  assert.doesNotMatch(html, /100 часов активности/);
  assert.doesNotMatch(html, /Заблокировано/);
});
