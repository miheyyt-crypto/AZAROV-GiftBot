import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FreeCasePanel } from "./FreeCasePanel.js";
import {
  catalogItemFromOpenResult,
  formatCountdown,
  formatRecentWinChance,
  formatRecentWinReward,
  formatRelativeTime,
  freeCaseResultCreditLine,
  friendlyFreeCaseError,
  lastOpeningFromFreeCaseOpen,
  recentWinFromFreeCaseOpen,
  remainingFromServer,
} from "./messages.js";
import { parseFreeCaseStatus } from "./parse.js";
import type { FreeCaseOpenResult, FreeCaseStatus } from "./types.js";
import {
  pinWinnerOnStrip,
  rouletteCenterOffsetPx,
  stripIndexUnderCenterPointer,
} from "../cases/roulette-strip.js";

const SAMPLE_STATUS: FreeCaseStatus = {
  caseCode: "free",
  available: true,
  nextAvailableAt: null,
  remainingSeconds: 0,
  displayTotals: { legendary: "6", epic: "20", common: "74" },
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
      itemCode: "nft-durov-glass",
      title: "Durov's Glass NFT",
      rarity: "legendary",
      rewardType: "external",
      displayChance: "1",
      imageKey: "nft-durov-glass",
    },
    {
      itemCode: "nft-loot-bag",
      title: "Loot Bag NFT",
      rarity: "legendary",
      rewardType: "external",
      displayChance: "1",
      imageKey: "nft-loot-bag",
    },
    {
      itemCode: "nft-diamond-ring",
      title: "Diamond Ring NFT",
      rarity: "legendary",
      rewardType: "external",
      displayChance: "1",
      imageKey: "nft-diamond-ring",
    },
    {
      itemCode: "nft-swiss-watch",
      title: "Swiss Watch NFT",
      rarity: "legendary",
      rewardType: "external",
      displayChance: "1",
      imageKey: "nft-swiss-watch",
    },
    {
      itemCode: "gram-2",
      title: "2 Gram",
      rarity: "epic",
      rewardType: "gram",
      displayChance: "5",
      imageKey: "gram-2",
    },
    {
      itemCode: "azc-100",
      title: "100 AZC",
      rarity: "common",
      rewardType: "azc",
      displayChance: "12.33",
      imageKey: "azc-100",
    },
    {
      itemCode: "azc-50",
      title: "50 AZC",
      rarity: "common",
      rewardType: "azc",
      displayChance: "12.33",
      imageKey: "azc-50",
    },
    {
      itemCode: "azc-25",
      title: "25 AZC",
      rarity: "common",
      rewardType: "azc",
      displayChance: "12.33",
      imageKey: "azc-25",
    },
    {
      itemCode: "gram-001",
      title: "0.01 Gram",
      rarity: "common",
      rewardType: "gram",
      displayChance: "12.33",
      imageKey: "gram-001",
    },
  ],
  lastOpening: null,
};

const noop = () => undefined;

test("free case available state shows free CTA", () => {
  const html = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: SAMPLE_STATUS,
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(html, /БЕСПЛАТНО/);
  assert.match(html, /Что внутри/);
  assert.doesNotMatch(html, /data-testid="free-case-countdown"/);
});

test("free case countdown uses server remaining seconds", () => {
  const next = new Date(Date.now() + 90_000).toISOString();
  const now = Date.now();
  const html = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: {
        ...SAMPLE_STATUS,
        available: false,
        nextAvailableAt: next,
        remainingSeconds: 90,
      },
      fetchedAtMs: now,
      nowMs: now,
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(html, /00:01:30/);
  assert.match(html, /disabled/);
});

test("contents sheet renders display odds only", () => {
  const html = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: SAMPLE_STATUS,
      showContents: true,
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(html, /Легендарные · 6%/);
  assert.match(html, /Эпические · 20%/);
  assert.match(html, /Обычные · 74%/);
  assert.match(html, /Шанс 12\.33%/);
  assert.match(html, /\/assets\/gram-icon\.png/);
  assert.match(html, /\/assets\/coin-icon\.png/);
  assert.match(html, /\/assets\/prize-durov-glass\.png/);
  assert.match(html, /\/assets\/prize-loot-bag\.png/);
  assert.match(html, /\/assets\/prize-diamond-ring\.png/);
  assert.match(html, /\/assets\/prize-swiss-watch\.png/);
  const gramPng = readFileSync(join(process.cwd(), "src/assets/gram-icon.png"));
  assert.equal(gramPng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const coinPng = readFileSync(join(process.cwd(), "src/assets/coin-icon.png"));
  assert.equal(coinPng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(coinPng[25], 6);
  for (const name of [
    "prize-durov-glass.png",
    "prize-loot-bag.png",
    "prize-diamond-ring.png",
    "prize-swiss-watch.png",
  ]) {
    const png = readFileSync(join(process.cwd(), "src/assets/prizes", name));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png[25], 6);
  }
  assert.doesNotMatch(html, /16\.664/);
  assert.doesNotMatch(html, /0\.001%/);
});

test("predetermined animation strip pins server winner", () => {
  const result: FreeCaseOpenResult = {
    openingId: "op-1",
    caseCode: "free",
    result: {
      itemCode: "azc-100",
      title: "100 AZC",
      rarity: "common",
      rewardType: "azc",
      displayChance: "12.33",
      realChance: "16.664333333333",
      imageKey: "azc-100",
    },
    nextAvailableAt: new Date(Date.now() + 86_400_000).toISOString(),
    balances: { azc: "100", gram: "0" },
  };
  const html = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: { ...SAMPLE_STATUS, available: false },
      animating: true,
      result,
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(html, /data-winner="azc-100"/);
  assert.match(html, /data-winner-title="100 AZC"/);
  assert.match(html, /data-winner-type="azc"/);
  assert.match(html, /data-strip-winner="true"/);
  const winnerChip = html.match(
    /data-strip-winner="true"[\s\S]*?roulette-item__name/,
  );
  assert.ok(winnerChip);
  assert.match(html, /data-strip-winner="true"/);
  const plan = pinWinnerOnStrip(
    SAMPLE_STATUS.catalog,
    catalogItemFromOpenResult(result.result),
  );
  assert.equal(plan.strip[plan.stopIndex]?.itemCode, "azc-100");
  assert.equal(
    stripIndexUnderCenterPointer(rouletteCenterOffsetPx(plan.stopIndex)),
    plan.stopIndex,
  );
});

function openResult(
  itemCode: string,
  title: string,
  rewardType: FreeCaseOpenResult["result"]["rewardType"],
  openingId: string,
): FreeCaseOpenResult {
  return {
    openingId,
    caseCode: "free",
    result: {
      itemCode,
      title,
      rarity: rewardType === "external" ? "legendary" : rewardType === "gram" && itemCode === "gram-50" ? "legendary" : "common",
      rewardType,
      displayChance: "1",
      realChance: "0.001",
      imageKey: itemCode,
    },
    nextAvailableAt: new Date(Date.now() + 86_400_000).toISOString(),
    balances: { azc: "0", gram: "0" },
  };
}

test("A gram-50 backend reward is the winning chip and result card", () => {
  const result = openResult("gram-50", "50 Gram", "gram", "op-gram-50");
  const reversed = {
    ...SAMPLE_STATUS,
    catalog: [...SAMPLE_STATUS.catalog].reverse(),
  };
  const spin = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: reversed,
      animating: true,
      result,
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(spin, /data-winner="gram-50"/);
  assert.match(spin, /data-winner-title="50 Gram"/);
  assert.match(spin, /data-winner-type="gram"/);
  assert.doesNotMatch(spin, /data-winner="azc-100"/);
  const modal = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: reversed,
      result,
      showResultModal: true,
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(modal, /data-winner="gram-50"/);
  assert.match(modal, /50 Gram/);
  assert.match(modal, /Gram зачислен/);
  assert.doesNotMatch(modal, /Монеты зачислены/);
  const plan = pinWinnerOnStrip(
    reversed.catalog,
    catalogItemFromOpenResult(result.result),
  );
  assert.equal(plan.strip[plan.stopIndex]?.itemCode, "gram-50");
  assert.equal(plan.strip[plan.stopIndex]?.title, "50 Gram");
  assert.equal(plan.strip[plan.stopIndex]?.rewardType, "gram");
});

test("B azc-100 backend reward is coins on strip and result, not Gram", () => {
  const result = openResult("azc-100", "100 AZC", "azc", "op-azc-100");
  const spin = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: SAMPLE_STATUS,
      animating: true,
      result,
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(spin, /data-winner="azc-100"/);
  assert.match(spin, /data-winner-type="azc"/);
  const modal = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: SAMPLE_STATUS,
      result,
      showResultModal: true,
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(modal, /data-testid="free-case-result"/);
  assert.match(modal, /data-winner="azc-100"/);
  assert.match(modal, /100 AZC|coin-amount/);
  assert.match(modal, /Монеты зачислены/);
  assert.match(modal, /data-winner-title="100 AZC"/);
  assert.doesNotMatch(modal, /data-testid="free-case-result"[^>]*data-winner="gram-50"/);
});

test("C winning item uses stable itemCode even if catalog is reordered", () => {
  const winner = catalogItemFromOpenResult(
    openResult("gram-50", "50 Gram", "gram", "op-id").result,
  );
  const byIndex = SAMPLE_STATUS.catalog[0];
  assert.ok(byIndex);
  const shuffled = [
    ...SAMPLE_STATUS.catalog.filter((item) => item.itemCode !== "gram-50"),
    winner,
  ];
  const plan = pinWinnerOnStrip(shuffled, winner);
  assert.notEqual(plan.stopIndex, shuffled.findIndex((item) => item.itemCode === "gram-50"));
  assert.equal(plan.strip[plan.stopIndex]?.itemCode, winner.itemCode);
});

test("E Home read model maps the persisted opening reward", () => {
  const opened = openResult("gram-50", "50 Gram", "gram", "opening-home");
  const recent = recentWinFromFreeCaseOpen(opened, "2026-09-19T12:00:00.000Z");
  const last = lastOpeningFromFreeCaseOpen(opened, "2026-09-19T12:00:00.000Z");
  assert.equal(recent.id, opened.openingId);
  assert.equal(recent.itemCode, "gram-50");
  assert.equal(recent.rewardLabel, "50 Gram");
  assert.equal(last.openingId, opened.openingId);
  assert.equal(last.itemCode, "gram-50");
  assert.equal(last.title, "50 Gram");
  assert.deepEqual(
    formatRecentWinReward({
      rewardLabel: recent.rewardLabel,
      title: recent.title,
      itemCode: recent.itemCode,
      payoutAzc: "100",
    }),
    { kind: "other", label: "50 Gram" },
  );
});

test("F second opening result does not show the first reward", () => {
  const first = openResult("gram-50", "50 Gram", "gram", "op-first");
  const second = openResult("azc-100", "100 AZC", "azc", "op-second");
  const html = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: {
        ...SAMPLE_STATUS,
        lastOpening: lastOpeningFromFreeCaseOpen(second),
      },
      result: second,
      showResultModal: true,
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(html, /data-opening-id="op-second"/);
  assert.match(html, /data-testid="free-case-result"[^>]*data-winner="azc-100"/);
  assert.doesNotMatch(html, /data-testid="free-case-result"[^>]*data-winner="gram-50"/);
  assert.doesNotMatch(html, /data-winner-title="50 Gram"/);
  assert.equal(freeCaseResultCreditLine(first.result.rewardType), "★ Gram зачислен на баланс!");
  assert.equal(freeCaseResultCreditLine(second.result.rewardType), "★ Монеты зачислены на баланс!");
});

test("result modal covers azc gram and external copy plus shop CTA", () => {
  for (const sample of [
    { title: "100 AZC", rewardType: "azc" as const, itemCode: "azc-100" },
    { title: "0.01 Gram", rewardType: "gram" as const, itemCode: "gram-001" },
    {
      title: "Diamond Ring NFT",
      rewardType: "external" as const,
      itemCode: "nft-diamond-ring",
    },
  ]) {
    const result: FreeCaseOpenResult = {
      openingId: `op-${sample.itemCode}`,
      caseCode: "free",
      result: {
        itemCode: sample.itemCode,
        title: sample.title,
        rarity: sample.rewardType === "external" ? "legendary" : "common",
        rewardType: sample.rewardType,
        displayChance: "1",
        realChance: "0.001",
        imageKey: sample.itemCode,
      },
      nextAvailableAt: new Date(Date.now() + 86_400_000).toISOString(),
      balances: { azc: "0", gram: "0" },
    };
    const html = renderToStaticMarkup(
      createElement(FreeCasePanel, {
        status: SAMPLE_STATUS,
        result,
        showResultModal: true,
        fetchedAtMs: Date.now(),
        onOpenContents: noop,
        onCloseContents: noop,
        onOpen: noop,
        onCloseResult: noop,
        onTryPaidCases: noop,
      }),
    );
    assert.match(html, /Поздравляем!/);
    assert.match(html, new RegExp(sample.title.replace(".", "\\.")));
    assert.match(html, /Открыть сейчас|Открыть кейсы/);
    assert.match(html, /уже начислена/);
  }
});

test("open button disabled while opening", () => {
  const html = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: SAMPLE_STATUS,
      opening: true,
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(html, /Открытие…/);
  assert.match(html, /disabled/);
});

test("retryable error note is shown", () => {
  const html = renderToStaticMarkup(
    createElement(FreeCasePanel, {
      status: SAMPLE_STATUS,
      errorNote: friendlyFreeCaseError(),
      fetchedAtMs: Date.now(),
      onOpenContents: noop,
      onCloseContents: noop,
      onOpen: noop,
      onCloseResult: noop,
      onTryPaidCases: noop,
    }),
  );
  assert.match(html, /Попробуйте ещё раз/);
});

test("parse status rejects missing display catalog fields", () => {
  assert.throws(() => parseFreeCaseStatus({ caseCode: "free" }));
});

test("countdown helpers stay server-anchored", () => {
  assert.equal(formatCountdown(3661), "01:01:01");
  const fetchedAt = 1_000_000;
  assert.equal(
    remainingFromServer(
      new Date(fetchedAt + 120_000).toISOString(),
      120,
      fetchedAt,
      fetchedAt + 30_000,
    ),
    90,
  );
});

test("recent win reward polish hides AZC letters and keeps Gram", () => {
  assert.deepEqual(
    formatRecentWinReward({
      rewardLabel: "Dice +10000 AZC",
      title: "Dice +10000 AZC",
    }),
    { kind: "azc", label: "10 000" },
  );
  assert.deepEqual(
    formatRecentWinReward({
      rewardLabel: "100 AZC",
      title: "100 AZC",
      payoutAzc: "100",
    }),
    { kind: "azc", label: "100" },
  );
  assert.deepEqual(
    formatRecentWinReward({
      rewardLabel: "50 Gram",
      title: "50 Gram",
      itemCode: "gram-50",
      payoutAzc: "100",
    }),
    { kind: "other", label: "50 Gram" },
  );
  assert.deepEqual(
    formatRecentWinReward({
      rewardLabel: "Diamond Ring NFT",
      title: "Diamond Ring NFT",
    }),
    { kind: "other", label: "Diamond Ring NFT" },
  );
  assert.equal(formatRecentWinChance("1"), "Шанс 1%");
  assert.equal(formatRecentWinChance(null), null);
  assert.equal(formatRecentWinChance(""), null);
  const dayAgo = Date.parse("2026-09-15T13:00:00.000Z");
  assert.equal(
    formatRelativeTime("2026-09-14T13:00:00.000Z", dayAgo),
    "1 дн. назад",
  );
});
