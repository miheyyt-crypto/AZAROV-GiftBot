import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BottomNavigation } from "../components/BottomNavigation.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { CoinHistoryPage, CoinHistoryList } from "../pages/CoinHistoryPage.js";
import { InventoryPage } from "../pages/InventoryPage.js";
import { NotificationsList, NotificationsPage } from "../pages/NotificationsPage.js";
import { OperationsHistoryList } from "../pages/OperationsHistoryPage.js";
import { OrdersPage } from "../pages/OrdersPage.js";
import { NoticeCopy } from "./NoticeCopy.js";
import { operationTabMatch } from "./profile-ui.js";
import { SUPPORT_URL } from "../lib/support.js";
import { ProfileView } from "./ProfileView.js";
import { EMPTY_PROFILE_SUMMARY } from "./types.js";
import type { ProfileSummary } from "./types.js";

const sample: ProfileSummary = {
  ...EMPTY_PROFILE_SUMMARY,
  user: {
    ...EMPTY_PROFILE_SUMMARY.user,
    displayName: "Bushman",
    telegramUsername: "bushman",
  },
  balances: { azc: "12840", gram: "0.016" },
  gram: {
    balance: "0.016",
    reserved: "0",
    available: "0.016",
    minimumWithdrawal: "20",
    canWithdraw: false,
  },
  level: {
    ...EMPTY_PROFILE_SUMMARY.level,
    current: 8,
    currentLevelXp: "1505",
    nextLevelXp: "1600",
    xpNeededForNext: "95",
    nextRewardAzc: "100",
  },
  activity: { kickChatMessages: "186" },
};

function renderProfile(extra: Partial<Parameters<typeof ProfileView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(ProfileView, {
      summary: sample,
      promo: "",
      onPromoChange: () => undefined,
      onPromoSubmit: () => undefined,
      onSupport: () => undefined,
      ...extra,
    }),
  );
}

test("profile view renders API data", () => {
  const html = renderProfile({ streamStreak: 4 });
  assert.match(html, /Bushman/);
  assert.match(html, /@bushman/);
  assert.match(html, /12 840/);
  assert.doesNotMatch(html, /AZC/);
  assert.match(html, /0\.016 Gram/);
  assert.match(html, /\/assets\/gram-icon\.png/);
  assert.match(html, /\/assets\/coin-icon\.png/);
  assert.match(html, /Минимум для вывода — 20 Gram/);
  assert.match(html, /186/);
  assert.match(html, /сообщений в чате/);
  assert.match(html, /стримов подряд/);
  assert.match(html, />4</);
  assert.match(html, /Уровень 8 → 9/);
  assert.match(html, /1 505 \/ 1 600 XP/);
  assert.match(html, /До следующего уровня: 95 XP/);
  assert.match(html, /Награда:/);
  assert.match(html, /100/);
  assert.match(html, /Опыт начисляется за засчитанные сообщения в чате Kick\./);
  assert.doesNotMatch(html, /минут/);
  assert.doesNotMatch(html, /просмотра стрима/);
  assert.doesNotMatch(html, /активност/);
  assert.match(html, /Уведомления/);
  assert.match(html, /История монет/);
  assert.match(html, /История операций/);
  assert.match(html, /Инвентарь/);
  assert.match(html, /Мои заказы/);
  assert.match(html, /Достижения/);
  assert.match(html, /Тех\. поддержка/);
  assert.equal(SUPPORT_URL, "https://t.me/azarovgiftbot_support");
  assert.match(html, /Не привязан/);
  assert.doesNotMatch(html, /Подключено/);
});

test("profile omits unread badge and watch-time copy", () => {
  const html = renderProfile();
  assert.doesNotMatch(html, /profile-menu__badge/);
  assert.doesNotMatch(html, /3 ч 59 мин/);
  const badged = renderProfile({
    summary: {
      ...sample,
      notifications: { unreadCount: 13 },
    },
  });
  assert.match(badged, /profile-menu__badge/);
  assert.match(badged, />13</);
});

test("profile Kick uses real linked username", () => {
  const html = renderProfile({
    summary: {
      ...sample,
      integrations: {
        ...sample.integrations,
        kick: {
          linked: true,
          username: "real_kick",
          displayName: "Real Kick",
          avatarUrl: "https://images.kick.com/real.png",
        },
      },
    },
  });
  assert.match(html, /@real_kick/);
  assert.match(html, /Подключено/);
  assert.doesNotMatch(html, /GazanGazanov/);
});

test("query panel has loading empty and error states", () => {
  const loading = renderToStaticMarkup(
    createElement(
      QueryPanel,
      {
        status: "loading",
        onRetry: () => undefined,
        loadingLabel: "Загрузка профиля",
      },
      "ready",
    ),
  );
  assert.match(loading, /Загрузка профиля/);
  const error = renderToStaticMarkup(
    createElement(
      QueryPanel,
      {
        status: "error",
        errorMessage: "boom",
        onRetry: () => undefined,
        loadingLabel: "Загрузка профиля",
      },
      "ready",
    ),
  );
  assert.match(error, /boom/);
  assert.match(error, /Повторить/);
  const ready = renderToStaticMarkup(
    createElement(
      QueryPanel,
      {
        status: "ready",
        onRetry: () => undefined,
        loadingLabel: "Загрузка профиля",
      },
      "готово",
    ),
  );
  assert.match(ready, /готово/);
});

test("profile detail routes render empty states without remote data", () => {
  const notifications = renderToStaticMarkup(
    createElement(NotificationsPage, { token: "t", skipRemote: true }),
  );
  assert.match(notifications, /Уведомлений пока нет/);
  const history = renderToStaticMarkup(
    createElement(CoinHistoryPage, { token: "t", skipRemote: true }),
  );
  assert.match(history, /Операций пока нет/);
  const inventory = renderToStaticMarkup(
    createElement(InventoryPage, { token: "t", skipRemote: true }),
  );
  assert.match(inventory, /Инвентарь пуст/);
  assert.match(inventory, /История ₽ заявок/);
  const orders = renderToStaticMarkup(
    createElement(OrdersPage, { token: "t", skipRemote: true }),
  );
  assert.match(orders, /У тебя пока нет заказов/);
});

test("notifications sheet uses real unread and has no mark-all action", () => {
  const html = renderToStaticMarkup(
    createElement(NotificationsPage, { token: "t", skipRemote: true }),
  );
  assert.match(html, /Уведомлений пока нет/);
  assert.doesNotMatch(html, /Прочитать все/);
  assert.doesNotMatch(html, /AZC/);
});

test("coin history filters by ledger delta sign and hides AZC", () => {
  const rows = [
    {
      id: "1",
      type: "paid_case_reward",
      label: "Выигрыш из кейса",
      delta: "50",
      balanceAfter: "1391",
      createdAt: "2026-09-16T16:55:00.000Z",
    },
    {
      id: "2",
      type: "dice_bet",
      label: "Dice — ставка",
      delta: "-100",
      balanceAfter: "1291",
      createdAt: "2026-09-16T16:56:00.000Z",
    },
    {
      id: "3",
      type: "stream_streak_reward",
      label: "Награда за серию стримов",
      delta: "0",
      balanceAfter: "1291",
      createdAt: "2026-09-16T16:57:00.000Z",
    },
  ];
  const all = renderToStaticMarkup(createElement(CoinHistoryList, { items: rows, filter: "all" }));
  assert.match(all, /Выигрыш из кейса/);
  assert.match(all, /Dice — ставка/);
  assert.doesNotMatch(all, /AZC/);
  const income = renderToStaticMarkup(createElement(CoinHistoryList, { items: rows, filter: "in" }));
  assert.match(income, /Выигрыш из кейса/);
  assert.doesNotMatch(income, /Dice — ставка/);
  const expense = renderToStaticMarkup(createElement(CoinHistoryList, { items: rows, filter: "out" }));
  assert.match(expense, /Dice — ставка/);
  assert.doesNotMatch(expense, /Выигрыш из кейса/);
});

test("operations history uses ledger types and omits missing balanceAfter", () => {
  const rows = [
    {
      id: "1",
      type: "paid_case_reward",
      label: "Выигрыш из кейса",
      delta: "50",
      balanceAfter: "1391",
      createdAt: "2026-09-16T16:55:00.000Z",
    },
    {
      id: "2",
      type: "shop_purchase",
      label: "Покупка в магазине",
      delta: "-200",
      balanceAfter: "",
      createdAt: "2026-09-16T16:56:00.000Z",
    },
    {
      id: "3",
      type: "dice_bet",
      label: "Dice — ставка",
      delta: "-100",
      balanceAfter: "1091",
      createdAt: "2026-09-16T16:57:00.000Z",
    },
  ];
  assert.equal(operationTabMatch(rows[0]!, "in"), true);
  assert.equal(operationTabMatch(rows[0]!, "reward"), true);
  assert.equal(operationTabMatch(rows[1]!, "purchase"), true);
  assert.equal(operationTabMatch(rows[2]!, "purchase"), false);
  assert.equal(operationTabMatch(rows[2]!, "reward"), false);
  const all = renderToStaticMarkup(createElement(OperationsHistoryList, { items: rows, tab: "all" }));
  assert.match(all, /Выигрыш из кейса/);
  assert.match(all, /Покупка в магазине/);
  assert.match(all, /Dice — ставка/);
  assert.match(all, /Баланс:/);
  assert.match(all, /1 391/);
  assert.doesNotMatch(all, /AZC/i);
  const withoutBalance = renderToStaticMarkup(
    createElement(OperationsHistoryList, { items: [rows[1]!], tab: "all" }),
  );
  assert.doesNotMatch(withoutBalance, /Баланс:/);
  const purchases = renderToStaticMarkup(
    createElement(OperationsHistoryList, { items: rows, tab: "purchase" }),
  );
  assert.match(purchases, /Покупка в магазине/);
  assert.doesNotMatch(purchases, /Выигрыш из кейса/);
  const rewards = renderToStaticMarkup(
    createElement(OperationsHistoryList, { items: rows, tab: "reward" }),
  );
  assert.match(rewards, /Выигрыш из кейса/);
  assert.doesNotMatch(rewards, /Покупка в магазине/);
});

test("rendered normal-user notification text does not contain AZC", () => {
  const html = renderToStaticMarkup(
    createElement(NotificationsList, {
      items: [
        {
          id: "n1",
          type: "task_completed",
          title: "Задание выполнено",
          body: "+100 AZC",
          createdAt: "2026-09-16T16:55:00.000Z",
          readAt: null,
        },
        {
          id: "n2",
          type: "promo_code_reward",
          title: "Промокод",
          body: "Начислено 250 AZC",
          createdAt: "2026-09-16T16:56:00.000Z",
          readAt: "2026-09-16T16:57:00.000Z",
        },
        {
          id: "n3",
          type: "level_reached",
          title: "Новый уровень",
          body: "Ты достиг 8 уровня и получил 100 AZC",
          createdAt: "2026-09-16T16:58:00.000Z",
          readAt: null,
        },
      ],
    }),
  );
  assert.match(html, /Задание выполнено/);
  assert.match(html, /Начислено/);
  assert.doesNotMatch(html, /AZC/i);
  const stripped = renderToStaticMarkup(createElement(NoticeCopy, { text: "Возвращено 40 AZC. Причина: тест" }));
  assert.match(stripped, /Возвращено/);
  assert.match(stripped, /Причина: тест/);
  assert.doesNotMatch(stripped, /AZC/i);
});

test("promo form shows success, friendly errors, and disables while loading", () => {
  const success = renderProfile({
    summary: { ...sample, balances: { azc: "13839", gram: "0.016" } },
    promoNote: "Промокод активирован\n+999",
  });
  assert.match(success, /Промокод активирован/);
  assert.match(success, /\+999/);
  assert.match(success, /13 839/);
  assert.doesNotMatch(success, /AZC/);

  const duplicate = renderProfile({
    promo: "AZAROV",
    promoNote: "Этот промокод уже использован",
  });
  assert.match(duplicate, /Этот промокод уже использован/);

  const missing = renderProfile({
    promo: "NOPE",
    promoNote: "Промокод не найден",
  });
  assert.match(missing, /Промокод не найден/);

  const loading = renderProfile({
    promo: "AZAROV",
    promoSubmitting: true,
  });
  assert.match(loading, /disabled/);
  assert.doesNotMatch(loading, /Промокоды/);

  const admin = renderProfile({ showAdminPromo: true });
  assert.match(admin, /Промокоды/);
  assert.match(admin, /Розыгрыши/);
  assert.match(admin, /Gram заявки/);
  assert.match(admin, /Заказы/);
  assert.match(admin, /Донаты/);
});

test("gram card keeps withdraw rule and remains openable below minimum", () => {
  const below = renderProfile();
  assert.match(below, /Минимум для вывода — 20 Gram/);
  assert.match(below, /Нажмите, чтобы открыть/);
  assert.doesNotMatch(below, /profile-gram" disabled/);

  const ready = renderProfile({
    summary: {
      ...sample,
      balances: { azc: "12840", gram: "23.45" },
      gram: {
        balance: "23.45",
        reserved: "0",
        available: "23.45",
        minimumWithdrawal: "20",
        canWithdraw: true,
      },
    },
  });
  assert.match(ready, /23\.45 Gram/);
  assert.doesNotMatch(ready, /Минимум для вывода — 20 Gram/);
});

test("withdrawal form shows available amount, username, loading and errors", () => {
  const form = renderProfile({
    summary: {
      ...sample,
      balances: { azc: "12840", gram: "23.45" },
      gram: {
        balance: "23.45",
        reserved: "0",
        available: "23.45",
        minimumWithdrawal: "20",
        canWithdraw: true,
      },
    },
    withdrawOpen: true,
    withdrawUsername: "@gift_user",
  });
  assert.match(form, /Доступно: 23\.45 Gram/);
  assert.match(form, /Будет выведен весь доступный баланс/);
  assert.match(form, /Telegram username/);
  assert.match(form, /Подтвердить/);

  const loading = renderProfile({
    withdrawOpen: true,
    withdrawUsername: "@gift_user",
    withdrawSubmitting: true,
  });
  assert.match(loading, /Отправка…/);

  const invalid = renderProfile({
    withdrawOpen: true,
    withdrawUsername: "bad",
    withdrawNote: "Укажите корректный Telegram username",
  });
  assert.match(invalid, /Укажите корректный Telegram username/);

  const success = renderProfile({
    withdrawNote: "Заявка создана на 23.45 Gram",
  });
  assert.match(success, /Заявка создана на 23\.45 Gram/);
});

test("shared bottom nav marks Profile as active", () => {
  const html = renderToStaticMarkup(
    createElement(BottomNavigation, { active: "profile" }),
  );
  assert.match(html, /aria-current="page" data-tab="profile"/);
  assert.doesNotMatch(html, /aria-current="page" data-tab="home"/);
});
