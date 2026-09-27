import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { friendlyPaidCaseError, paidCaseResultCopy } from "./messages.js";
import { parsePaidCaseCatalog } from "./parse.js";
import { PaidCaseSheet } from "./PaidCaseSheet.js";
import {
  paidCaseRewardRarity,
  paidCaseRewardTitle,
} from "./paid-case-ui.js";
import type { PaidCaseCatalog, PaidCaseCatalogItem, PaidCaseOpenResult } from "./types.js";
import { ReferralCaseSheet } from "../referral-case/ReferralCaseSheet.js";
import { ShopView } from "../shop/ShopView.js";
import { CASE_CASH_ART_SRC, caseCashArtKind } from "../assets/case-cash-art.js";

function item(
  partial: PaidCaseCatalogItem,
): PaidCaseCatalogItem {
  return partial;
}

const POOR: PaidCaseCatalog = {
  code: "poor",
  title: "Нищий",
  priceAzc: "8999",
  items: [
    item({
      itemCode: "poor-cash-5000",
      title: "5 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "5000",
      realChance: "0.001",
      displayChance: null,
      imageKey: "poor-cash-5000",
    }),
    item({
      itemCode: "poor-cash-1000",
      title: "1 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "1000",
      realChance: "0.001",
      displayChance: null,
      imageKey: "poor-cash-1000",
    }),
    item({
      itemCode: "poor-azc-12000",
      title: "12 000 AZC",
      rewardType: "azc",
      rewardAmount: "12000",
      realChance: "7",
      displayChance: null,
      imageKey: "poor-azc-12000",
    }),
    item({
      itemCode: "poor-azc-7777",
      title: "7 777 AZC",
      rewardType: "azc",
      rewardAmount: "7777",
      realChance: "10",
      displayChance: null,
      imageKey: "poor-azc-7777",
    }),
    item({
      itemCode: "poor-azc-5000",
      title: "5 000 AZC",
      rewardType: "azc",
      rewardAmount: "5000",
      realChance: "20",
      displayChance: null,
      imageKey: "poor-azc-5000",
    }),
    item({
      itemCode: "poor-azc-3333",
      title: "3 333 AZC",
      rewardType: "azc",
      rewardAmount: "3333",
      realChance: "62.998",
      displayChance: null,
      imageKey: "poor-azc-3333",
    }),
  ],
};

const MEDIUM: PaidCaseCatalog = {
  code: "medium",
  title: "Средний",
  priceAzc: "22222",
  items: [
    item({
      itemCode: "medium-cash-10000",
      title: "10 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "10000",
      realChance: "0.001",
      displayChance: null,
      imageKey: "medium-cash-10000",
    }),
    item({
      itemCode: "medium-cash-5000",
      title: "5 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "5000",
      realChance: "0.001",
      displayChance: null,
      imageKey: "medium-cash-5000",
    }),
    item({
      itemCode: "medium-cash-1000",
      title: "1 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "1000",
      realChance: "0.1",
      displayChance: null,
      imageKey: "medium-cash-1000",
    }),
    item({
      itemCode: "medium-azc-20000",
      title: "20 000 AZC",
      rewardType: "azc",
      rewardAmount: "20000",
      realChance: "11",
      displayChance: null,
      imageKey: "medium-azc-20000",
    }),
    item({
      itemCode: "medium-azc-11111",
      title: "11 111 AZC",
      rewardType: "azc",
      rewardAmount: "11111",
      realChance: "28",
      displayChance: null,
      imageKey: "medium-azc-11111",
    }),
    item({
      itemCode: "medium-azc-8888",
      title: "8 888 AZC",
      rewardType: "azc",
      rewardAmount: "8888",
      realChance: "60.898",
      displayChance: null,
      imageKey: "medium-azc-8888",
    }),
  ],
};

const BLATNOY: PaidCaseCatalog = {
  code: "blatnoy",
  title: "Блатной",
  priceAzc: "64999",
  items: [
    item({
      itemCode: "blatnoy-cash-30000",
      title: "30 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "30000",
      realChance: "0.001",
      displayChance: null,
      imageKey: "blatnoy-cash-30000",
    }),
    item({
      itemCode: "blatnoy-cash-10000",
      title: "10 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "10000",
      realChance: "0.001",
      displayChance: null,
      imageKey: "blatnoy-cash-10000",
    }),
    item({
      itemCode: "blatnoy-cash-5000",
      title: "5 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "5000",
      realChance: "1",
      displayChance: null,
      imageKey: "blatnoy-cash-5000",
    }),
    item({
      itemCode: "blatnoy-cash-2000",
      title: "2 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "2000",
      realChance: "1",
      displayChance: null,
      imageKey: "blatnoy-cash-2000",
    }),
    item({
      itemCode: "blatnoy-azc-44444",
      title: "44 444 AZC",
      rewardType: "azc",
      rewardAmount: "44444",
      realChance: "35",
      displayChance: null,
      imageKey: "blatnoy-azc-44444",
    }),
    item({
      itemCode: "blatnoy-azc-22222",
      title: "22 222 AZC",
      rewardType: "azc",
      rewardAmount: "22222",
      realChance: "62.998",
      displayChance: null,
      imageKey: "blatnoy-azc-22222",
    }),
  ],
};

const SAMPLE_CATALOG = [POOR, MEDIUM, BLATNOY];
const noop = () => undefined;

test("cash ruble case art maps 10000/20000/30000, 5000, and other amounts", () => {
  assert.equal(caseCashArtKind("10000"), "high");
  assert.equal(caseCashArtKind("20 000"), "high");
  assert.equal(caseCashArtKind("30000"), "high");
  assert.equal(caseCashArtKind("5000"), "5000");
  assert.equal(caseCashArtKind("2000"), "other");
  assert.equal(caseCashArtKind("1000"), "other");
  assert.equal(CASE_CASH_ART_SRC.high, "/assets/case-cash-high.png");
  for (const name of ["case-cash-high.png", "case-cash-5000.png", "case-cash-other.png"]) {
    const png = readFileSync(join(process.cwd(), "src/assets/cases", name));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png[25], 6);
  }
});

test("paid cases catalog shows exact prices and referral soon card", () => {
  const html = renderToStaticMarkup(
    createElement(ShopView, {
      catalog: [],
      paidCases: SAMPLE_CATALOG,
      balanceAzc: "100000",
      mainTab: "cases",
      filter: "all",
      fields: {},
      onMainTabChange: noop,
      onFilterChange: noop,
      onSelect: noop,
      onClose: noop,
      onFieldChange: noop,
      onBuy: noop,
      onOrders: noop,
      onSelectPaidCase: noop,
      onClosePaidCase: noop,
      onOpenPaidCase: noop,
      onClosePaidCaseResult: noop,
    }),
  );
  assert.match(html, /Нищий/);
  assert.match(html, /8 999/);
  assert.match(html, /22 222/);
  assert.match(html, /64 999/);
  assert.doesNotMatch(html, / AZC/);
  assert.match(html, /Реферальный кейс/);
  assert.match(html, /Осталось пригласить/);
  assert.match(html, /Что внутри/);
  assert.match(html, /data-testid="referral-case-link"/);
  assert.doesNotMatch(html, /href="#\/friends"/);
  assert.doesNotMatch(html, /Tower|TOWER/);
});

test("PaidCaseSheet renders catalog rewards without odds next to items", () => {
  const html = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: POOR,
      balanceAzc: "1391",
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(html, /paid-case-sheet/);
  assert.match(html, /Что внутри/);
  assert.doesNotMatch(html, /Шансы реальные/);
  assert.doesNotMatch(html, /paid-reward__chance/);
  assert.match(html, /Нищий кейс/);
  assert.equal((html.match(/paid-reward /g) ?? []).length, 6);
  assert.doesNotMatch(html, /0\.001%/);
  assert.doesNotMatch(html, />7%</);
  assert.doesNotMatch(html, />10%</);
  assert.doesNotMatch(html, />20%</);
  assert.doesNotMatch(html, /62\.998%/);
  assert.doesNotMatch(html, />1%</);
  assert.doesNotMatch(html, />5%</);
  assert.doesNotMatch(html, /57%/);
  assert.match(html, /5 000 РУБЛЕЙ!/);
  assert.match(html, /1 000 Рублей/);
  assert.match(html, /12 000 Монет/);
  assert.match(html, /7 777 Монет/);
  assert.match(html, /5 000 Монет/);
  assert.match(html, /3 333 Монеты/);
  assert.doesNotMatch(html, /AZC/);
  assert.match(html, /Нужно ещё 7 608 монет/);
  assert.match(html, /Не хватает монет/);
  assert.match(html, /disabled/);
  assert.match(html, /aria-label="Закрыть"/);
  assert.match(html, /\/assets\/case-cash-5000\.png/);
  assert.match(html, /\/assets\/case-cash-other\.png/);
  assert.doesNotMatch(html, /\/assets\/case-cash-high\.png/);
  assert.match(html, /\/assets\/coin-icon\.png/);
});

test("medium and blatnoy sheets keep their own catalog rewards without odds", () => {
  const mediumHtml = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: MEDIUM,
      balanceAzc: "22222",
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(mediumHtml, /10 000 РУБЛЕЙ!/);
  assert.match(mediumHtml, /20 000 Монет/);
  assert.match(mediumHtml, /11 111 Монет/);
  assert.match(mediumHtml, /8 888 Монет/);
  assert.doesNotMatch(mediumHtml, /0\.1%/);
  assert.doesNotMatch(mediumHtml, />11%</);
  assert.doesNotMatch(mediumHtml, />28%</);
  assert.doesNotMatch(mediumHtml, /60\.898%/);
  assert.doesNotMatch(mediumHtml, /paid-reward__chance/);
  assert.doesNotMatch(mediumHtml, /AZC/);
  assert.doesNotMatch(mediumHtml, /disabled/);
  assert.match(mediumHtml, /Открыть за/);
  assert.match(mediumHtml, /\/assets\/case-cash-high\.png/);
  assert.match(mediumHtml, /\/assets\/case-cash-5000\.png/);
  assert.match(mediumHtml, /\/assets\/case-cash-other\.png/);

  const blatnoyHtml = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: BLATNOY,
      balanceAzc: "1000",
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(blatnoyHtml, /30 000 РУБЛЕЙ!/);
  assert.match(blatnoyHtml, /44 444 Монеты/);
  assert.match(blatnoyHtml, /22 222 Монеты/);
  assert.doesNotMatch(blatnoyHtml, />1%/);
  assert.doesNotMatch(blatnoyHtml, />35%/);
  assert.doesNotMatch(blatnoyHtml, /62\.998%/);
  assert.doesNotMatch(blatnoyHtml, /AZC/);
  assert.match(blatnoyHtml, /\/assets\/case-cash-high\.png/);
  assert.match(blatnoyHtml, /\/assets\/case-cash-5000\.png/);
  assert.match(blatnoyHtml, /\/assets\/case-cash-other\.png/);
});

test("disabled CTA does not invoke open; sufficient CTA keeps open handler", () => {
  let opens = 0;
  const html = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: POOR,
      balanceAzc: "100",
      onClose: noop,
      onOpen: () => {
        opens += 1;
      },
      onCloseResult: noop,
    }),
  );
  assert.match(html, /paid-case-cta--disabled/);
  assert.match(html, /disabled/);
  assert.equal(opens, 0);

  const ok = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: POOR,
      balanceAzc: "8999",
      onClose: noop,
      onOpen: () => {
        opens += 1;
      },
      onCloseResult: noop,
    }),
  );
  assert.match(ok, /Открыть за/);
  assert.doesNotMatch(ok, /paid-case-cta--disabled/);
  assert.doesNotMatch(ok, /Нужно ещё/);
});

test("AZC and cash result modal copy", () => {
  const azcResult: PaidCaseOpenResult = {
    openingId: "op-azc",
    caseCode: "poor",
    priceAzc: "8999",
    result: {
      itemCode: "poor-azc-3333",
      title: "3 333 AZC",
      rewardType: "azc",
      rewardAmount: "3333",
      realChance: "62.998",
      displayChance: null,
      imageKey: "poor-azc-3333",
    },
    balances: { azc: "1000" },
  };
  const cashResult: PaidCaseOpenResult = {
    openingId: "op-cash",
    caseCode: "poor",
    priceAzc: "8999",
    result: {
      itemCode: "poor-cash-1000",
      title: "1 000 ₽",
      rewardType: "cash_rub",
      rewardAmountRub: "1000",
      realChance: "0.001",
      displayChance: null,
      imageKey: "poor-cash-1000",
    },
    balances: { azc: "1000" },
  };

  const azcHtml = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: POOR,
      result: azcResult,
      showResultModal: true,
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(azcHtml, /3 333 Монеты/);
  assert.doesNotMatch(azcHtml, /AZC/);
  assert.match(azcHtml, /Начислено на баланс/);
  assert.equal(paidCaseResultCopy("azc"), "Начислено на баланс");

  const cashHtml = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: POOR,
      result: cashResult,
      showResultModal: true,
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(cashHtml, /1 000 Рублей/);
  assert.match(cashHtml, /Приз добавлен в инвентарь/);
  assert.match(cashHtml, /Открыть инвентарь/);
  assert.equal(paidCaseResultCopy("cash_rub"), "Приз добавлен в инвентарь");
});

test("paid strip pins backend itemCode even if catalog order changes", () => {
  const reversed = { ...POOR, items: [...POOR.items].reverse() };
  const result: PaidCaseOpenResult = {
    openingId: "op-pin",
    caseCode: "poor",
    priceAzc: "8999",
    result: {
      itemCode: "poor-azc-3333",
      title: "3 333 AZC",
      rewardType: "azc",
      rewardAmount: "3333",
      realChance: "62.998",
      displayChance: null,
      imageKey: "poor-azc-3333",
    },
    balances: { azc: "1000" },
  };
  const html = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: reversed,
      animating: true,
      result,
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(html, /data-winner="poor-azc-3333"/);
});

test("insufficient balance friendly error", () => {
  assert.equal(
    friendlyPaidCaseError("CASE_INSUFFICIENT_BALANCE"),
    "Недостаточно монет для открытия кейса",
  );
  const html = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: POOR,
      balanceAzc: "0",
      errorNote: friendlyPaidCaseError("CASE_INSUFFICIENT_BALANCE"),
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(html, /Недостаточно монет для открытия кейса/);
});

test("parsePaidCaseCatalog accepts items wrapper and rejects invented odds", () => {
  const parsed = parsePaidCaseCatalog({ items: SAMPLE_CATALOG });
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.priceAzc, "8999");
  assert.equal(parsed[0]?.items[0]?.displayChance, null);
  assert.equal(parsed[0]?.items[0]?.realChance, "0.001");
  assert.equal(parsed[0]?.items[5]?.realChance, "62.998");
});

test("presentation mapping uses reward type and realChance, not UI index", () => {
  assert.equal(paidCaseRewardRarity(POOR.items[0]!, POOR.items), "legendary");
  assert.equal(paidCaseRewardRarity(POOR.items[1]!, POOR.items), "epic");
  assert.equal(paidCaseRewardRarity(POOR.items[2]!, POOR.items), "epic");
  assert.equal(paidCaseRewardRarity(POOR.items[3]!, POOR.items), "rare");
  assert.equal(paidCaseRewardRarity(POOR.items[4]!, POOR.items), "rare");
  assert.equal(paidCaseRewardRarity(POOR.items[5]!, POOR.items), "common");
  assert.equal(paidCaseRewardTitle(POOR.items[5]!), "3 333 Монеты");
});

test("Referral Case mechanics stay separate from paid sheet", () => {
  const html = renderToStaticMarkup(
    createElement(ReferralCaseSheet, {
      catalog: {
        code: "referral",
        title: "Реферальный",
        priceAzc: null,
        requiresEntitlement: true,
        availableCases: 2,
        items: [
          {
            itemCode: "ref-azc",
            title: "8 888 AZC",
            rewardType: "azc",
            rewardAmount: "8888",
            displayChance: null,
            imageKey: "ref-azc",
          },
        ],
      },
      availableCases: 2,
      opening: false,
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(html, /Реферальный/);
  assert.match(html, /Доступно кейсов: 2/);
  assert.doesNotMatch(html, /Не хватает монет/);
  assert.doesNotMatch(html, /Открыть за/);
  assert.match(html, /paid-case-sheet/);
  assert.match(html, /8 888 Монет/);
  assert.doesNotMatch(html, /AZC/);
});

test("parseRecentWins allows null rarity and paid case sources", async () => {
  const { parseRecentWins } = await import("../free-case/parse.js");
  const { recentWinSourceLabel } = await import("../free-case/messages.js");
  const parsed = parseRecentWins({
    items: [
      {
        id: "1",
        source: "poor_case",
        username: "a",
        publicId: null,
        title: "3 333 AZC",
        itemCode: "poor-azc-3333",
        rarity: null,
        realChance: "62.998",
        createdAt: new Date().toISOString(),
      },
      {
        id: "2",
        source: "free_case",
        username: null,
        publicId: "u1",
        title: "100 AZC",
        itemCode: "azc-100",
        rarity: "common",
        realChance: "16.66",
        createdAt: new Date().toISOString(),
      },
    ],
  });
  assert.equal(parsed.items[0]?.rarity, null);
  assert.equal(parsed.items[0]?.source, "poor_case");
  assert.equal(recentWinSourceLabel("poor_case"), "Нищий кейс");
  assert.equal(recentWinSourceLabel("medium_case"), "Средний кейс");
  assert.equal(recentWinSourceLabel("blatnoy_case"), "Блатной кейс");
});
