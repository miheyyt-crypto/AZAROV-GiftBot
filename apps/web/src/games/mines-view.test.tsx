import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resetAzcBalanceStoreForTests } from "../hooks/useAzcBalance.js";
import { MinesPage } from "../pages/MinesPage.js";
import { clampMinesBet, MINES_MAX_BET, MINES_MIN_BET } from "./mines-ui.js";

test("mines chrome matches V2 coins layout without Stars", () => {
  resetAzcBalanceStoreForTests();
  const html = renderToStaticMarkup(
    createElement(MinesPage, { token: "fixture", skipRemote: true }),
  );
  assert.match(html, />Mines</);
  assert.match(html, /СУММА СТАВКИ/);
  assert.match(html, /КОЛИЧЕСТВО МИН/);
  assert.match(html, /Начать игру/);
  assert.match(html, /МАКС/);
  assert.match(html, /2 500/);
  assert.match(html, /½/);
  assert.match(html, /2×/);
  assert.doesNotMatch(html, /Stars/);
  assert.doesNotMatch(html, /GRAM/);
  assert.doesNotMatch(html, /AZC/i);
  assert.match(html, /\/assets\/coin-icon\.png/);
  assert.equal((html.match(/mines-cell/g) ?? []).length >= 25, true);
  assert.equal(clampMinesBet(10), MINES_MIN_BET);
  assert.equal(clampMinesBet(50_000), MINES_MAX_BET);
  assert.equal(MINES_MIN_BET, 100);
});
