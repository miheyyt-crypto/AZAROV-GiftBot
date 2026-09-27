import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiRequestError } from "../api.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { parseDicePlay, parseMinesStart } from "../games/parse.js";
import { parseRollsBetResult } from "../games/rolls-parse.js";
import { DicePage } from "../pages/DicePage.js";
import { MinesPage } from "../pages/MinesPage.js";
import { RollsPage } from "../pages/RollsPage.js";
import { ShopView } from "../shop/ShopView.js";
import type { ShopCatalogProduct } from "../shop/shop-messages.js";
import {
  applyServerBalance,
  azcFromMutation,
  getAzcBalance,
  refreshBalanceIfAmbiguous,
  resetAzcBalanceStoreForTests,
  syncBalanceFromMutation,
} from "./useAzcBalance.js";

afterEach(() => {
  resetAzcBalanceStoreForTests();
});

const NOOP = (): void => undefined;

const DONAT: ShopCatalogProduct = {
  code: "donat",
  title: "Донат на стрим",
  category: "donations",
  priceAzc: "1000",
  fulfillmentType: "manual",
  requiredFields: ["displayNickname", "donationText"],
  description: "Донат на стрим.",
};

function shopHtml(balanceAzc: string, success = false): string {
  return renderToStaticMarkup(
    createElement(ShopView, {
      catalog: [DONAT],
      balanceAzc,
      mainTab: "store",
      filter: "all",
      fields: {},
      success,
      ...(success
        ? {
            successOrder: {
              orderId: "ord-1",
              productTitle: "Донат на стрим",
              priceAzc: "1000",
              fulfillmentType: "manual" as const,
            },
          }
        : {}),
      onMainTabChange: NOOP,
      onFilterChange: NOOP,
      onSelect: NOOP,
      onClose: NOOP,
      onFieldChange: NOOP,
      onBuy: NOOP,
      onOrders: NOOP,
    }),
  );
}

test("shop purchase success applies server newBalanceAzc before success popup", () => {
  resetAzcBalanceStoreForTests();
  applyServerBalance("10000");
  assert.match(shopHtml(getAzcBalance()), /10 000/);

  applyServerBalance("9000");
  const html = shopHtml(getAzcBalance(), true);
  assert.match(html, /9 000/);
  assert.doesNotMatch(html, /10 000/);
  assert.match(html, /Заказ создан/);
});

test("rolls accepted bet uses mutation newBalanceAzc; payout uses server refresh value", () => {
  resetAzcBalanceStoreForTests();
  applyServerBalance("10000");
  const bet = parseRollsBetResult({
    round: {
      roundId: "r1",
      status: "betting",
      version: "1",
      participantCount: 1,
      totalPotAzc: "100",
      bettingDeadline: new Date().toISOString(),
      bettingStartedAt: new Date().toISOString(),
      spinStartedAt: null,
      spinDurationMs: 8000,
      serverSeedHash: "h",
      serverSeed: null,
      nonce: "0",
      algorithm: "azarov:v1:rolls",
      aggregateClientSeed: null,
      participantSnapshotHash: null,
      winningTicket: null,
      winnerParticipantId: null,
      winnerUserId: null,
      payoutAzc: null,
      participants: [],
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    },
    you: { stakeAzc: "100", chancePercent: "100.00", participantId: "p1" },
    replayed: false,
    newBalanceAzc: "9900",
  });
  applyServerBalance(bet.newBalanceAzc);
  assert.equal(getAzcBalance(), "9900");
  const rollsAfterBet = renderToStaticMarkup(
    createElement(RollsPage, { token: "t", skipRemote: true }),
  );
  assert.match(rollsAfterBet, /9 900/);

  applyServerBalance("10900");
  assert.equal(getAzcBalance(), "10900");
});

test("mines start debit and cashout win use server newBalanceAzc", () => {
  resetAzcBalanceStoreForTests();
  applyServerBalance("10000");
  const started = parseMinesStart({
    game: {
      gameId: "g1",
      status: "active",
      betAzc: "100",
      mineCount: 5,
      revealedCells: [],
      safePickCount: 0,
      currentMultiplier: "1.00",
      potentialPayoutAzc: "100",
      payoutAzc: null,
      serverSeedHash: "h",
      serverSeed: null,
      clientSeed: "c",
      nonce: "1",
      algorithm: "hmac-sha256",
      minePositions: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    },
    replayed: false,
    newBalanceAzc: "9900",
  });
  applyServerBalance(started.newBalanceAzc);
  assert.equal(getAzcBalance(), "9900");
  assert.match(
    renderToStaticMarkup(createElement(MinesPage, { token: "t", skipRemote: true })),
    /9 900/,
  );

  applyServerBalance("10150");
  assert.equal(getAzcBalance(), "10150");
});

test("dice play result applies server newBalanceAzc immediately", () => {
  resetAzcBalanceStoreForTests();
  applyServerBalance("10000");
  const played = parseDicePlay({
    round: {
      id: "d1",
      betAzc: "100",
      chance: 50,
      multiplierDisplay: "2.00",
      rawResult: 1,
      displayResult: "00.01",
      win: false,
      payoutAzc: "0",
      serverSeedHash: "h",
      serverSeed: "s",
      clientSeed: "c",
      nonce: "1",
      algorithm: "hmac-sha256",
      createdAt: new Date().toISOString(),
    },
    replayed: false,
    newBalanceAzc: "9900",
  });
  applyServerBalance(played.newBalanceAzc);
  assert.equal(getAzcBalance(), "9900");
  assert.match(
    renderToStaticMarkup(createElement(DicePage, { token: "t", skipRemote: true })),
    /9 900/,
  );
});

test("paid case open applies balances.azc from server result", () => {
  resetAzcBalanceStoreForTests();
  applyServerBalance("20000");
  const fromCase = azcFromMutation({
    balances: { azc: "14334" },
    result: { title: "x" },
  });
  applyServerBalance(fromCase);
  assert.equal(getAzcBalance(), "14334");
  assert.match(
    renderToStaticMarkup(
      createElement(BalanceBadge, { amountAzcString: getAzcBalance() }),
    ),
    /14 334/,
  );
});

test("failed mutation leaves shared balance unchanged", async () => {
  resetAzcBalanceStoreForTests();
  applyServerBalance("10000");
  const before = getAzcBalance();
  assert.equal(azcFromMutation({ error: "INSUFFICIENT_BALANCE" }), undefined);
  await refreshBalanceIfAmbiguous(
    "token",
    new ApiRequestError(409, "nope", "INSUFFICIENT_BALANCE"),
  );
  assert.equal(getAzcBalance(), before);
});

test("shared balance stays consistent across shop and game headers", () => {
  resetAzcBalanceStoreForTests();
  applyServerBalance("480000");
  const shop = shopHtml(getAzcBalance());
  const dice = renderToStaticMarkup(
    createElement(DicePage, { token: "t", skipRemote: true }),
  );
  const mines = renderToStaticMarkup(
    createElement(MinesPage, { token: "t", skipRemote: true }),
  );
  assert.match(shop, /480 000/);
  assert.match(dice, /480 000/);
  assert.match(mines, /480 000/);
});

test("syncBalanceFromMutation prefers DTO over guessing a debit", async () => {
  resetAzcBalanceStoreForTests();
  applyServerBalance("500");
  await syncBalanceFromMutation("t", { newBalanceAzc: "400" });
  assert.equal(getAzcBalance(), "400");
  await syncBalanceFromMutation("t", { balances: { azc: "900" } });
  assert.equal(getAzcBalance(), "900");
});
