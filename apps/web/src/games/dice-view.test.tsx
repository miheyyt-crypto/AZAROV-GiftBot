import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resetAzcBalanceStoreForTests } from "../hooks/useAzcBalance.js";
import { DicePage } from "../pages/DicePage.js";
import type { DiceRound } from "./types.js";
import {
  clampDiceBet,
  clampDiceChance,
  DICE_MAX_BET,
  DICE_MIN_BET,
  diceMultiplierPreview,
  dicePotentialPayout,
} from "./dice-ui.js";

const WIN: DiceRound = {
  id: "fixture-win",
  betAzc: "100",
  chance: 50,
  multiplierDisplay: "2.00",
  rawResult: 123456,
  displayResult: "12.34",
  win: true,
  payoutAzc: "200",
  serverSeedHash: "h",
  serverSeed: "s",
  clientSeed: "c",
  nonce: "1",
  algorithm: "hmac-sha256",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const LOSS: DiceRound = {
  ...WIN,
  id: "fixture-loss",
  win: false,
  payoutAzc: "0",
  displayResult: "73.42",
  rawResult: 734200,
};

test("dice idle chrome uses coins, real chance/multiplier, and no fake over/under", () => {
  resetAzcBalanceStoreForTests();
  const html = renderToStaticMarkup(
    createElement(DicePage, { token: "fixture", skipRemote: true }),
  );
  assert.match(html, />Dice</);
  assert.match(html, /Бросить/);
  assert.match(html, /СУММА СТАВКИ/);
  assert.match(html, /ШАНС/);
  assert.match(html, /МНОЖИТЕЛЬ/);
  assert.match(html, />50%</);
  assert.match(html, /×2\.00/);
  assert.match(html, /Возможный выигрыш/);
  assert.match(html, />200</);
  assert.match(html, /\/assets\/coin-icon\.png/);
  assert.match(html, /½/);
  assert.match(html, /2×/);
  assert.match(html, /МАКС/);
  assert.match(html, /2 500/);
  assert.match(html, /type="range"/);
  assert.match(html, /min="1"/);
  assert.match(html, /max="95"/);
  assert.match(html, /dice-slider__bubble/);
  assert.match(html, />1%</);
  assert.match(html, />95%</);
  assert.match(html, /aria-label="Шанс"/);
  assert.match(html, /Client seed \/ Provably Fair/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /AZC/i);
  assert.doesNotMatch(html, /Stars/);
  assert.doesNotMatch(html, /Меньше/);
  assert.doesNotMatch(html, /Больше/);
  assert.doesNotMatch(html, /over\/under/i);
  assert.equal(diceMultiplierPreview(50), "2.00");
  assert.equal(dicePotentialPayout(100, 50), 200);
  assert.equal(dicePotentialPayout(100, 95), 105);
  assert.equal(clampDiceBet(10), DICE_MIN_BET);
  assert.equal(clampDiceBet(50_000), DICE_MAX_BET);
  assert.equal(clampDiceChance(0), 1);
  assert.equal(clampDiceChance(99), 95);
});

test("dice fixture win/loss states use API fields only", () => {
  resetAzcBalanceStoreForTests();
  const winHtml = renderToStaticMarkup(
    createElement(DicePage, {
      token: "fixture",
      skipRemote: true,
      fixtureRound: WIN,
    }),
  );
  assert.match(winHtml, /Победа/);
  assert.match(winHtml, /12\.34/);
  assert.match(winHtml, /dice-result is-win/);
  assert.match(winHtml, /dice-hero__result is-win/);

  const lossHtml = renderToStaticMarkup(
    createElement(DicePage, {
      token: "fixture",
      skipRemote: true,
      fixtureRound: LOSS,
    }),
  );
  assert.match(lossHtml, /Не повезло/);
  assert.match(lossHtml, /73\.42/);
  assert.match(lossHtml, /dice-result is-loss/);
  assert.doesNotMatch(lossHtml, /AZC/i);
});
