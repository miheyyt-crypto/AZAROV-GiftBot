import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  friendlyReferralCaseError,
  referralCaseResultCopy,
} from "./messages.js";
import { parseReferralCaseCatalog, parseReferralCaseOpenResult } from "./parse.js";
import { ReferralCaseSheet } from "./ReferralCaseSheet.js";
import type { ReferralCaseCatalog, ReferralCaseOpenResult } from "./types.js";

const SAMPLE: ReferralCaseCatalog = {
  code: "referral",
  title: "Реферальный",
  priceAzc: null,
  requiresEntitlement: true,
  availableCases: 2,
  items: [
    {
      itemCode: "referral-cash-3000",
      title: "3 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "3000",
      displayChance: null,
      imageKey: "referral-cash-3000",
    },
    {
      itemCode: "referral-azc-1000",
      title: "1 000 AZC",
      rewardType: "azc",
      rewardAmount: "1000",
      displayChance: null,
      imageKey: "referral-azc-1000",
    },
  ],
};

const noop = () => undefined;

test("parse referral catalog keeps displayChance null", () => {
  const parsed = parseReferralCaseCatalog(SAMPLE);
  assert.equal(parsed.code, "referral");
  assert.equal(parsed.availableCases, 2);
  for (const item of parsed.items) {
    assert.equal(item.displayChance, null);
  }
});

test("sheet shows Открыть when cases available and omits chance", () => {
  const html = renderToStaticMarkup(
    createElement(ReferralCaseSheet, {
      catalog: SAMPLE,
      availableCases: 2,
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(html, /Открыть/);
  assert.match(html, /Реферальный кейс/);
  assert.match(html, /Что внутри/);
  assert.match(html, /3 000 РУБЛЕЙ!/);
  assert.match(html, /1 000 Монет/);
  assert.doesNotMatch(html, /Шанс/);
  assert.doesNotMatch(html, /AZC/);
  assert.match(html, /paid-case-sheet/);
  assert.match(html, /referral-case\.webp/);
});

test("sheet disables when no cases", () => {
  const html = renderToStaticMarkup(
    createElement(ReferralCaseSheet, {
      catalog: SAMPLE,
      availableCases: 0,
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(html, /Нет кейсов/);
});

test("result modal copy", () => {
  const result: ReferralCaseOpenResult = {
    openingId: "op1",
    caseCode: "referral",
    result: {
      itemCode: "referral-azc-1000",
      title: "1 000 AZC",
      rewardType: "azc",
      rewardAmount: "1000",
      realChance: "41",
      displayChance: null,
      imageKey: "referral-azc-1000",
    },
    balances: { azc: "1000" },
    availableCases: 0,
  };
  const parsed = parseReferralCaseOpenResult(result);
  assert.equal(parsed.result.rewardType, "azc");
  assert.equal(referralCaseResultCopy("azc"), "Начислено на баланс");
  assert.equal(referralCaseResultCopy("cash_rub"), "Приз добавлен в инвентарь");
  assert.equal(
    friendlyReferralCaseError("REFERRAL_CASE_NOT_AVAILABLE"),
    "Нет доступных реферальных кейсов",
  );

  const html = renderToStaticMarkup(
    createElement(ReferralCaseSheet, {
      catalog: SAMPLE,
      availableCases: 0,
      result: parsed,
      showResultModal: true,
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(html, /Поздравляем/);
  assert.match(html, /1 000 Монет/);
  assert.doesNotMatch(html, / AZC/);
});
