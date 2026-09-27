import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminCashWithdrawalsView } from "../admin/AdminCashWithdrawalsView.js";
import { CashWithdrawalsPage } from "../pages/CashWithdrawalsPage.js";
import { InventoryView } from "../pages/InventoryPage.js";
import { CashWithdrawalHistoryView } from "../profile/CashWithdrawalHistoryView.js";
import {
  friendlyCashError,
  friendlyCashItemStatus,
  friendlyCashStatus,
} from "../profile/cash-messages.js";

test("inventory shows available reserved consumed cash states", () => {
  const html = renderToStaticMarkup(
    createElement(InventoryView, {
      items: [
        {
          type: "cash_rub",
          id: "c1",
          amountRub: "3000",
          source: "medium_case",
          status: "available",
          activeWithdrawal: null,
        },
        {
          type: "cash_rub",
          id: "c2",
          amountRub: "1000",
          source: "free_case",
          status: "reserved",
          activeWithdrawal: {
            id: "w1",
            status: "pending",
            welvuraId: "wid",
            createdAt: "2026-09-14T00:00:00.000Z",
          },
        },
        {
          type: "cash_rub",
          id: "c3",
          amountRub: "5000",
          source: "blatnoy_case",
          status: "consumed",
          activeWithdrawal: null,
        },
      ],
      welvuraId: "",
      onSelect: () => undefined,
      onClose: () => undefined,
      onWelvuraChange: () => undefined,
      onSubmit: () => undefined,
      onHistory: () => undefined,
    }),
  );
  assert.match(html, /3 000 ₽/);
  assert.match(html, /Получить/);
  assert.match(html, /На выводе/);
  assert.match(html, /Получено/);
  assert.doesNotMatch(html, /Забрать/);
  assert.doesNotMatch(html, /Claim/i);
  assert.match(html, /\/assets\/case-cash-other\.png/);
  assert.match(html, /\/assets\/case-cash-5000\.png/);
  assert.doesNotMatch(html, /\/assets\/case-cash-high\.png/);
  assert.doesNotMatch(html, /shop-welvura/);
});

test("withdraw sheet shows amount source and welvura field", () => {
  const html = renderToStaticMarkup(
    createElement(InventoryView, {
      items: [
        {
          type: "cash_rub",
          id: "c1",
          amountRub: "3000",
          source: "medium_case",
          status: "available",
          activeWithdrawal: null,
        },
      ],
      selected: {
        type: "cash_rub",
        id: "c1",
        amountRub: "3000",
        source: "medium_case",
        status: "available",
        activeWithdrawal: null,
      },
      welvuraId: "WID",
      submitting: true,
      note: "Некорректный Welvura ID",
      onSelect: () => undefined,
      onClose: () => undefined,
      onWelvuraChange: () => undefined,
      onSubmit: () => undefined,
      onHistory: () => undefined,
    }),
  );
  assert.match(html, /Welvura ID/);
  assert.match(html, /Отправка/);
  assert.match(html, /Некорректный Welvura ID/);
  assert.match(html, /Средний кейс/);
});

test("cash history shows statuses and rejection reason", () => {
  const html = renderToStaticMarkup(
    createElement(CashWithdrawalHistoryView, {
      items: [
        {
          id: "w1",
          inventoryItemId: "i1",
          amountRub: "3000",
          welvuraId: "wid_user",
          source: "medium_case",
          status: "pending",
          rejectionReason: null,
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z",
          processingAt: null,
          fulfilledAt: null,
          rejectedAt: null,
        },
        {
          id: "w2",
          inventoryItemId: "i2",
          amountRub: "1000",
          welvuraId: "wid_user",
          source: "free_case",
          status: "rejected",
          rejectionReason: "неверный ID",
          createdAt: "2026-09-13T00:00:00.000Z",
          updatedAt: "2026-09-13T00:00:00.000Z",
          processingAt: null,
          fulfilledAt: null,
          rejectedAt: "2026-09-13T00:00:00.000Z",
        },
      ],
    }),
  );
  assert.match(html, /3 000 ₽/);
  assert.match(html, /Ожидает/);
  assert.match(html, /Отклонено/);
  assert.match(html, /неверный ID/);
});

test("empty cash history page renders without remote data", () => {
  const html = renderToStaticMarkup(
    createElement(CashWithdrawalsPage, { token: "t", skipRemote: true }),
  );
  assert.equal(html.includes("₽ заявки"), true);
  assert.match(html, /Заявок пока нет/);
  assert.doesNotMatch(html, /AZC/);
});

test("admin cash view has process fulfill reject actions", () => {
  const html = renderToStaticMarkup(
    createElement(AdminCashWithdrawalsView, {
      items: [
        {
          id: "w1",
          user: "user-1",
          telegramUsername: "gift_user",
          inventoryItemId: "item-1",
          amountRub: "3000",
          welvuraId: "wid",
          source: "medium_case",
          status: "pending",
          rejectionReason: null,
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z",
          processingAt: null,
          fulfilledAt: null,
          rejectedAt: null,
          processedByAdminId: null,
        },
      ],
      status: "pending",
      reason: "",
      onStatusChange: () => undefined,
      onReasonChange: () => undefined,
      onProcess: () => undefined,
      onFulfill: () => undefined,
      onReject: () => undefined,
    }),
  );
  assert.match(html, /user-1/);
  assert.match(html, /3 000 ₽/);
  assert.match(html, /В обработку/);
  assert.match(html, /Выполнено/);
  assert.match(html, /Отклонить/);
  assert.match(html, /Причина отклонения/);
});

test("cash errors and statuses stay user-friendly", () => {
  assert.equal(friendlyCashStatus("processing"), "В обработке");
  assert.equal(friendlyCashItemStatus("reserved"), "На выводе");
  assert.equal(
    friendlyCashError("CASH_WITHDRAWAL_INVALID_WELVURA_ID"),
    "Некорректный Welvura ID",
  );
  assert.doesNotMatch(friendlyCashError("SQLSTATE_23505"), /SQL|23505/);
});
