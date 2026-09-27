import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminGiveawaysPage } from "../pages/AdminGiveawaysPage.js";
import { AdminPromoPage } from "../pages/AdminPromoPage.js";
import { AdminBroadcastPage } from "../pages/AdminBroadcastPage.js";
import { AdminWelvuraPage } from "../pages/AdminWelvuraPage.js";
import { AdminShopOrdersPage } from "../pages/AdminShopOrdersPage.js";
import { AdminCashWithdrawalsPage } from "../pages/AdminCashWithdrawalsPage.js";
import { AdminGramWithdrawalsPage } from "../pages/AdminGramWithdrawalsPage.js";
import { BottomSheet } from "./BottomSheet.js";
import { CloseButton } from "./CloseButton.js";
import { PageHeader } from "./PageHeader.js";
import { CashWithdrawalsPage } from "../pages/CashWithdrawalsPage.js";
import { CoinHistoryPage } from "../pages/CoinHistoryPage.js";
import { DicePage } from "../pages/DicePage.js";
import { GiveawaysPage } from "../pages/GiveawaysPage.js";
import { GramWithdrawalsPage } from "../pages/GramWithdrawalsPage.js";
import { LeaderboardPage } from "../pages/LeaderboardPage.js";
import { MinesPage } from "../pages/MinesPage.js";
import { NotificationsPage } from "../pages/NotificationsPage.js";
import { OperationsHistoryPage } from "../pages/OperationsHistoryPage.js";
import { OrdersPage } from "../pages/OrdersPage.js";
import { RollsPage } from "../pages/RollsPage.js";
import { WelvuraPage } from "../pages/WelvuraPage.js";
import { PaidCaseSheet } from "../paid-case/PaidCaseSheet.js";

function closeHrefs(html: string): string[] {
  return [...html.matchAll(/data-close-href="([^"]*)"/g)].map((row) => row[1] ?? "");
}

function closeButtons(html: string): number {
  return html.split('data-testid="close-btn"').length - 1;
}

test("CloseButton renders SVG X not emoji", () => {
  const html = renderToStaticMarkup(
    createElement(CloseButton, { onClick: () => undefined, ariaLabel: "Закрыть" }),
  );
  assert.match(html, /aria-label="Закрыть"/);
  assert.match(html, /<svg /);
  assert.doesNotMatch(html, /❌|×/);
});

test("admin X navigates to Mini App home", () => {
  const pages = [
    AdminGiveawaysPage,
    AdminWelvuraPage,
    AdminShopOrdersPage,
    AdminCashWithdrawalsPage,
    AdminGramWithdrawalsPage,
    AdminPromoPage,
    AdminBroadcastPage,
  ];
  for (const Page of pages) {
    const html = renderToStaticMarkup(
      createElement(Page, { skipRemote: true, isSuperAdmin: true }),
    );
    assert.deepEqual(closeHrefs(html), ["#/"]);
    assert.equal(closeButtons(html), 1);
    assert.match(html, /aria-label="Закрыть"/);
  }
});

test("user nested pages use parent close hrefs once", () => {
  const cases: Array<[string, string]> = [
    [
      renderToStaticMarkup(createElement(OrdersPage, { token: "t", skipRemote: true })),
      "#/shop",
    ],
    [
      renderToStaticMarkup(
        createElement(OperationsHistoryPage, { token: "t", skipRemote: true }),
      ),
      "#/profile",
    ],
    [
      renderToStaticMarkup(createElement(CoinHistoryPage, { token: "t", skipRemote: true })),
      "",
    ],
    [
      renderToStaticMarkup(
        createElement(CashWithdrawalsPage, { token: "t", skipRemote: true }),
      ),
      "#/profile/inventory",
    ],
    [
      renderToStaticMarkup(
        createElement(GramWithdrawalsPage, { token: "t", skipRemote: true }),
      ),
      "#/profile",
    ],
    [
      renderToStaticMarkup(createElement(LeaderboardPage, { token: "t", skipRemote: true })),
      "#/",
    ],
    [
      renderToStaticMarkup(
        createElement(GiveawaysPage, { token: "t", skipRemote: true }),
      ),
      "#/",
    ],
    [
      renderToStaticMarkup(createElement(WelvuraPage, { token: "t", skipRemote: true })),
      "#/tasks",
    ],
    [
      renderToStaticMarkup(createElement(DicePage, { token: "t", skipRemote: true })),
      "#/",
    ],
    [
      renderToStaticMarkup(createElement(MinesPage, { token: "t", skipRemote: true })),
      "#/",
    ],
    [
      renderToStaticMarkup(createElement(RollsPage, { token: "t", skipRemote: true })),
      "#/",
    ],
  ];
  for (const [html, href] of cases) {
    assert.equal(closeButtons(html), 1);
    if (href) {
      assert.deepEqual(closeHrefs(html), [href]);
      assert.match(html, /aria-label="Назад"/);
    } else {
      assert.deepEqual(closeHrefs(html), []);
      assert.match(html, /aria-label="Закрыть"/);
    }
  }
});

test("sheets expose a single close control that calls onClose", () => {
  let closed = 0;
  const html = renderToStaticMarkup(
    createElement(BottomSheet, {
      open: true,
      title: "Лист",
      onClose: () => {
        closed += 1;
      },
      children: "body",
    }),
  );
  assert.equal(closeButtons(html), 1);
  assert.doesNotMatch(html, /data-close-href=/);
  assert.match(html, /aria-label="Закрыть"/);
  assert.equal(closed, 0);

  const notes = renderToStaticMarkup(
    createElement(NotificationsPage, { token: "t", skipRemote: true }),
  );
  assert.equal(closeButtons(notes), 1);

  const paid = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: {
        code: "poor",
        title: "Нищий",
        priceAzc: "8999",
        items: [
          {
            itemCode: "poor-azc-12000",
            title: "12 000 AZC",
            rewardType: "azc",
            rewardAmount: "12000",
            realChance: "7",
            displayChance: null,
            imageKey: "poor-azc-12000",
          },
        ],
      },
      balanceAzc: "100000",
      opening: false,
      animating: false,
      result: null,
      showResultModal: false,
      onOpen: () => undefined,
      onClose: () => undefined,
      onCloseResult: () => undefined,
    }),
  );
  assert.equal(closeButtons(paid), 1);
});

test("PageHeader does not render a second back control", () => {
  const html = renderToStaticMarkup(
    createElement(PageHeader, { title: "T", backHref: "#/shop" }),
  );
  assert.equal(closeButtons(html), 1);
  assert.doesNotMatch(html, /icon-btn/);
  assert.deepEqual(closeHrefs(html), ["#/shop"]);
});
