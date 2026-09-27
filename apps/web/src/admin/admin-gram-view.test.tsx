import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GramWithdrawalsPage } from "../pages/GramWithdrawalsPage.js";
import { AdminGramWithdrawalsView } from "./AdminGramWithdrawalsView.js";
import { GramWithdrawalHistoryView } from "../profile/GramWithdrawalHistoryView.js";
import { friendlyGramError, friendlyGramStatus } from "../profile/gram-messages.js";

test("gram history shows friendly statuses and reject reason", () => {
  const html = renderToStaticMarkup(
    createElement(GramWithdrawalHistoryView, {
      items: [
        {
          id: "w1",
          amountGram: "23.45",
          telegramUsername: "gift_user",
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
          amountGram: "20",
          telegramUsername: "gift_user",
          status: "rejected",
          rejectionReason: "неверный username",
          createdAt: "2026-09-13T00:00:00.000Z",
          updatedAt: "2026-09-13T00:00:00.000Z",
          processingAt: null,
          fulfilledAt: null,
          rejectedAt: "2026-09-13T00:00:00.000Z",
        },
      ],
    }),
  );
  assert.match(html, /23\.45 Gram/);
  assert.match(html, /@gift_user/);
  assert.match(html, /Ожидает/);
  assert.match(html, /Отклонено/);
  assert.match(html, /неверный username/);
});

test("empty gram history page renders without remote data", () => {
  const html = renderToStaticMarkup(
    createElement(GramWithdrawalsPage, { token: "t", skipRemote: true }),
  );
  assert.match(html, /Заявок пока нет/);
});

test("admin gram view has process fulfill reject actions", () => {
  const html = renderToStaticMarkup(
    createElement(AdminGramWithdrawalsView, {
      items: [
        {
          id: "w1",
          user: "user-1",
          amountGram: "25",
          telegramUsername: "gift_user",
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
  assert.match(html, /25 Gram/);
  assert.match(html, /В обработку/);
  assert.match(html, /Выполнено/);
  assert.match(html, /Отклонить/);
  assert.match(html, /Причина отклонения/);
});

test("gram errors stay user-friendly", () => {
  assert.equal(friendlyGramStatus("processing"), "В обработке");
  assert.equal(friendlyGramStatus("fulfilled"), "Выполнено");
  assert.equal(
    friendlyGramError("GRAM_WITHDRAWAL_MINIMUM_NOT_REACHED"),
    "Недостаточно Gram для вывода",
  );
  assert.doesNotMatch(friendlyGramError("SQLSTATE_23505"), /SQL|23505/);
});
