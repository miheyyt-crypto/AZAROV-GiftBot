import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FreeCasePanel } from "../free-case/FreeCasePanel.js";
import type { FreeCaseOpenResult, FreeCaseStatus } from "../free-case/types.js";
import { PaidCaseSheet } from "../paid-case/PaidCaseSheet.js";
import type { PaidCaseCatalog, PaidCaseOpenResult } from "../paid-case/types.js";
import { ReferralCaseSheet } from "../referral-case/ReferralCaseSheet.js";
import type {
  ReferralCaseCatalog,
  ReferralCaseOpenResult,
} from "../referral-case/types.js";
import {
  CASE_ROULETTE_ANIMATION_MS,
  ROULETTE_GAP,
  ROULETTE_ITEM_WIDTH,
} from "./roulette-strip.js";
import { caseCashArtKind, CASE_CASH_ART_SRC } from "../assets/case-cash-art.js";

const noop = () => undefined;

const FREE_STATUS: FreeCaseStatus = {
  caseCode: "free",
  available: true,
  nextAvailableAt: null,
  remainingSeconds: 0,
  displayTotals: { legendary: "1", epic: "1", common: "2" },
  catalog: [
    {
      itemCode: "gram-50",
      title: "50 Gram",
      rarity: "legendary",
      rewardType: "gram",
      displayChance: "1",
      imageKey: "gram-50",
    },
    {
      itemCode: "azc-100",
      title: "100 AZC",
      rarity: "common",
      rewardType: "azc",
      displayChance: "12",
      imageKey: "azc-100",
    },
    {
      itemCode: "nft-ring",
      title: "Diamond Ring NFT",
      rarity: "epic",
      rewardType: "external",
      displayChance: "1",
      imageKey: "nft-diamond-ring",
    },
  ],
  lastOpening: null,
};

const PAID: PaidCaseCatalog = {
  code: "blatnoy",
  title: "Блатной",
  priceAzc: "64999",
  items: [
    {
      itemCode: "blatnoy-cash-30000",
      title: "30 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "30000",
      realChance: "0.001",
      displayChance: null,
      imageKey: "blatnoy-cash-30000",
    },
    {
      itemCode: "blatnoy-cash-10000",
      title: "10 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "10000",
      realChance: "0.001",
      displayChance: null,
      imageKey: "blatnoy-cash-10000",
    },
    {
      itemCode: "blatnoy-cash-5000",
      title: "5 000 ₽",
      rewardType: "cash_rub",
      rewardAmount: "5000",
      realChance: "1",
      displayChance: null,
      imageKey: "blatnoy-cash-5000",
    },
    {
      itemCode: "blatnoy-azc-44444",
      title: "44 444 AZC",
      rewardType: "azc",
      rewardAmount: "44444",
      realChance: "35",
      displayChance: null,
      imageKey: "blatnoy-azc-44444",
    },
  ],
};

const REFERRAL: ReferralCaseCatalog = {
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

function paidResult(itemCode: string, openingId: string): PaidCaseOpenResult {
  const item = PAID.items.find((row) => row.itemCode === itemCode);
  assert.ok(item);
  return {
    openingId,
    caseCode: "blatnoy",
    priceAzc: "64999",
    result: {
      itemCode: item.itemCode,
      title: item.title,
      rewardType: item.rewardType,
      rewardAmount: item.rewardAmount,
      realChance: item.realChance,
      displayChance: null,
      imageKey: item.imageKey,
    },
    balances: { azc: "1000" },
  };
}

test("CSS chip geometry matches TS constants and viewport does not page-scroll", () => {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  assert.match(css, /\.case-roulette__chip[\s\S]*?width:\s*84px/);
  assert.match(css, /\.case-roulette__chip[\s\S]*?flex:\s*0 0 84px/);
  assert.match(css, /\.case-roulette__track[\s\S]*?gap:\s*12px/);
  assert.match(css, /\.case-roulette__viewport[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.case-roulette[\s\S]*?overflow:\s*hidden/);
  assert.doesNotMatch(css, /grid-template-rows:\s*minmax\(7\.4rem,\s*1\.38fr\)/);
  assert.doesNotMatch(css, /min-height:\s*min\(90vh,\s*90dvh\)/);
  assert.equal(ROULETTE_ITEM_WIDTH, 84);
  assert.equal(ROULETTE_GAP, 12);
  assert.equal(CASE_ROULETTE_ANIMATION_MS, 6200);
});

test("paid spinning hides contents and shows shared roulette", () => {
  const idle = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: PAID,
      balanceAzc: "100000",
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(idle, /data-case-view="idle"/);
  assert.match(idle, /data-testid="paid-case-contents"/);
  assert.match(idle, /Что внутри/);
  assert.doesNotMatch(idle, /data-testid="paid-case-strip"/);
  assert.doesNotMatch(idle, /data-testid="paid-case-result"/);

  const spin = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: { ...PAID, items: [...PAID.items].reverse() },
      balanceAzc: "100000",
      animating: true,
      result: paidResult("blatnoy-azc-44444", "op-1"),
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(spin, /data-case-view="spinning"/);
  assert.match(spin, /data-testid="case-roulette"/);
  assert.match(spin, /data-testid="paid-case-strip"/);
  assert.match(spin, /data-winner="blatnoy-azc-44444"/);
  assert.match(spin, /data-strip-winner="true"/);
  assert.match(spin, /Открываем кейс/);
  assert.doesNotMatch(spin, /data-testid="paid-case-contents"/);
  assert.doesNotMatch(spin, /Что внутри/);
  assert.doesNotMatch(spin, /data-testid="paid-case-result"/);
  assert.match(spin, /data-chip-width="84"/);
  assert.match(spin, /data-chip-gap="12"/);
  const widths = spin.match(/data-chip-width="(\d+)"/g) ?? [];
  assert.ok(widths.length > 4);
  assert.ok(widths.every((token) => token === 'data-chip-width="84"'));
  assert.match(spin, /case-cash-high\.png/);
  assert.match(spin, /coin-icon\.png/);
});

test("paid result uses backend itemCode and is not shown during spin", () => {
  const first = paidResult("blatnoy-cash-30000", "op-first");
  const second = paidResult("blatnoy-azc-44444", "op-second");
  const spin = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: PAID,
      animating: true,
      result: second,
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(spin, /data-winner="blatnoy-azc-44444"/);
  assert.doesNotMatch(spin, /data-testid="paid-case-result"/);

  const modal = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: PAID,
      result: second,
      showResultModal: true,
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(modal, /data-testid="paid-case-result"/);
  assert.match(modal, /data-opening-id="op-second"/);
  assert.match(modal, /data-winner="blatnoy-azc-44444"/);
  assert.doesNotMatch(modal, /data-opening-id="op-first"/);
  assert.doesNotMatch(modal, /data-winner="blatnoy-cash-30000"/);
  assert.equal(first.result.itemCode, "blatnoy-cash-30000");
  assert.equal(caseCashArtKind("30000"), "high");
  assert.equal(CASE_CASH_ART_SRC.high, "/assets/case-cash-high.png");
  assert.match(modal, /44 444 Монеты/);
});

test("referral spinning matches paid geometry and hides contents", () => {
  const result: ReferralCaseOpenResult = {
    openingId: "ref-2",
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
    availableCases: 1,
  };
  const html = renderToStaticMarkup(
    createElement(ReferralCaseSheet, {
      catalog: { ...REFERRAL, items: [...REFERRAL.items].reverse() },
      availableCases: 2,
      animating: true,
      result,
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(html, /data-case-view="spinning"/);
  assert.match(html, /data-testid="case-roulette"/);
  assert.match(html, /data-testid="referral-case-strip"/);
  assert.match(html, /data-winner="referral-azc-1000"/);
  assert.doesNotMatch(html, /data-testid="referral-case-contents"/);
  assert.doesNotMatch(html, /Что внутри/);
  assert.match(html, /data-chip-width="84"/);
  assert.match(html, /translate3d\(-/);
});

test("free spinning hides contents sheet and uses shared chip size", () => {
  const result: FreeCaseOpenResult = {
    openingId: "free-2",
    caseCode: "free",
    result: {
      itemCode: "gram-50",
      title: "50 Gram",
      rarity: "legendary",
      rewardType: "gram",
      displayChance: "1",
      realChance: "0.001",
      imageKey: "gram-50",
    },
    nextAvailableAt: new Date(Date.now() + 86_400_000).toISOString(),
    balances: { azc: "0", gram: "50" },
  };
  const html = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: { ...FREE_STATUS, catalog: [...FREE_STATUS.catalog].reverse() },
      animating: true,
      result,
      showContents: true,
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(html, /data-case-view="spinning"/);
  assert.match(html, /data-testid="case-roulette"/);
  assert.match(html, /data-winner="gram-50"/);
  assert.match(html, /data-chip-width="84"/);
  assert.doesNotMatch(html, /data-testid="free-case-contents"/);
  assert.doesNotMatch(html, /data-testid="free-case-result"/);
  assert.match(html, /gram-icon\.png|prize-art--gram/);
});

test("paid contents maps cash and azc art without stretching grid class", () => {
  const html = renderToStaticMarkup(
    createElement(PaidCaseSheet, {
      paidCase: PAID,
      balanceAzc: "100000",
      onClose: noop,
      onOpen: noop,
      onCloseResult: noop,
    }),
  );
  assert.match(html, /30 000 РУБЛЕЙ!/);
  assert.match(html, /10 000 Рублей/);
  assert.match(html, /5 000 Рублей/);
  assert.match(html, /44 444 Монеты/);
  assert.match(html, /\/assets\/case-cash-high\.png/);
  assert.match(html, /\/assets\/case-cash-5000\.png/);
  assert.match(html, /\/assets\/coin-icon\.png/);
});
