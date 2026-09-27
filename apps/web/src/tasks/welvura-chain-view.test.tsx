import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WelvuraChainView } from "./WelvuraChainView.js";
import type { WelvuraState } from "./types.js";

const DEPOSIT_INSTRUCTION =
  "Пополни счёт на 100 ₽ или больше и пришли скриншот вместе со своим ID. Засчитываются только новые депозиты начиная с 11 сентября. (Депозит учитывается только после подтверждённой привязки аккаунта)";

function stage(
  partial: Partial<WelvuraState["stages"][number]> &
    Pick<WelvuraState["stages"][number], "stageNumber" | "requiredDepositRub" | "rewardAzc" | "state">,
): WelvuraState["stages"][number] {
  return {
    instruction: DEPOSIT_INSTRUCTION.replace("100", partial.requiredDepositRub),
    rejectionReason: null,
    ...partial,
  };
}

const unbound: WelvuraState = {
  account: {
    state: "not_submitted",
    welvuraId: null,
    rejectionReason: null,
    rewardAzc: "1000",
  },
  policy: { depositsFrom: "2026-09-11", oneDepositOneStage: true },
  progress: { completedStages: 0, totalStages: 13 },
  stages: [
    stage({
      stageNumber: 1,
      requiredDepositRub: "100",
      rewardAzc: "2000",
      state: "locked",
    }),
    stage({
      stageNumber: 2,
      requiredDepositRub: "1000",
      rewardAzc: "3000",
      state: "locked",
    }),
  ],
};

test("welvura locked stages stay readable without parent opacity", () => {
  const html = renderToStaticMarkup(
    createElement(WelvuraChainView, {
      token: "fixture",
      skipRemote: true,
      initialState: unbound,
    }),
  );
  assert.match(html, /welvura-stage--locked/);
  assert.doesNotMatch(html, /welvura-stage--locked[^>]*style="[^"]*opacity/);
  assert.match(html, /После привязки/);
  assert.match(html, /Пополни счёт на 100 ₽/);
  assert.match(html, /2 000/);
  assert.match(html, /3 000/);
  assert.doesNotMatch(html, /AZC/);
  assert.doesNotMatch(html, /Tower|TOWER/);
  assert.doesNotMatch(html, /Закрытое сообщество/);

  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  const lockedBlock = css.match(/\.welvura-stage--locked\s*\{[^}]+\}/);
  assert.ok(lockedBlock);
  assert.doesNotMatch(lockedBlock[0]!, /opacity\s*:/);
});

test("available Stage 1 renders the real form", () => {
  const html = renderToStaticMarkup(
    createElement(WelvuraChainView, {
      token: "fixture",
      skipRemote: true,
      initialState: unbound,
    }),
  );
  assert.match(html, /Введите Welvura ID/);
  assert.match(html, /Загрузить скриншот/);
  assert.match(html, /Отправить на проверку/);
  assert.match(html, /welvura-stage--locked/);
  assert.match(html, /coin-amount/);
  assert.match(html, /<span>1 000<\/span>/);
  assert.doesNotMatch(html, /без награды/);
  assert.doesNotMatch(html, /На проверке/);
});

test("pending Stage 1 hides the bind form", () => {
  const pending: WelvuraState = {
    ...unbound,
    account: { state: "pending", welvuraId: "WID", rejectionReason: null, rewardAzc: "1000" },
  };
  const html = renderToStaticMarkup(
    createElement(WelvuraChainView, {
      token: "fixture",
      skipRemote: true,
      initialState: pending,
    }),
  );
  assert.match(html, /На проверке/);
  assert.match(html, /coin-amount/);
  assert.match(html, /<span>1 000<\/span>/);
  assert.doesNotMatch(html, /без награды/);
  assert.doesNotMatch(html, /Введите Welvura ID/);
  assert.doesNotMatch(html, /Отправить на проверку/);
});

test("production preview cannot make pending look available", () => {
  const pending: WelvuraState = {
    ...unbound,
    account: { state: "pending", welvuraId: "WID", rejectionReason: null, rewardAzc: "1000" },
  };
  const html = renderToStaticMarkup(
    createElement(WelvuraChainView, {
      token: "fixture",
      skipRemote: true,
      initialState: pending,
      previewSearch: "?dev=user&welvuraPreview=available",
      previewEnv: { nodeEnv: "production", allowDevAuth: true },
    }),
  );
  assert.match(html, /На проверке/);
  assert.doesNotMatch(html, /Введите Welvura ID/);
});

test("dev preview available is overlay-only and keeps catalog rewards", () => {
  const pending: WelvuraState = {
    ...unbound,
    account: { state: "pending", welvuraId: "WID", rejectionReason: null, rewardAzc: "1000" },
  };
  const html = renderToStaticMarkup(
    createElement(WelvuraChainView, {
      token: "fixture",
      skipRemote: true,
      initialState: pending,
      previewSearch: "?dev=user&welvuraPreview=available",
      previewEnv: { nodeEnv: "development", allowDevAuth: true },
    }),
  );
  assert.match(html, /Введите Welvura ID/);
  assert.match(html, /<span>1 000<\/span>/);
  assert.match(html, /2 000/);
  assert.match(html, /3 000/);
  assert.doesNotMatch(html, /без награды/);
  assert.doesNotMatch(html, /На проверке/);
});

test("welvura stage rewards and labels follow configured state", () => {
  const state: WelvuraState = {
    account: { state: "approved", welvuraId: "WID-1", rejectionReason: null, rewardAzc: "1000" },
    policy: { depositsFrom: "2026-09-11", oneDepositOneStage: true },
    progress: { completedStages: 1, totalStages: 13 },
    stages: [
      stage({
        stageNumber: 1,
        requiredDepositRub: "100",
        rewardAzc: "2000",
        state: "approved",
      }),
      stage({
        stageNumber: 2,
        requiredDepositRub: "1000",
        rewardAzc: "3000",
        state: "available",
      }),
      stage({
        stageNumber: 3,
        requiredDepositRub: "2500",
        rewardAzc: "5000",
        state: "pending",
      }),
      stage({
        stageNumber: 4,
        requiredDepositRub: "5000",
        rewardAzc: "10000",
        state: "rejected",
        rejectionReason: "нечитаемый скриншот",
      }),
      stage({
        stageNumber: 5,
        requiredDepositRub: "10000",
        rewardAzc: "20000",
        state: "locked",
      }),
    ],
  };
  const html = renderToStaticMarkup(
    createElement(WelvuraChainView, {
      token: "fixture",
      skipRemote: true,
      initialState: state,
    }),
  );
  assert.match(html, /2 000/);
  assert.match(html, /3 000/);
  assert.match(html, /5 000/);
  assert.match(html, /10 000/);
  assert.match(html, /20 000/);
  assert.match(html, /<span>1 000<\/span>/);
  assert.match(html, /✓ Выполнено/);
  assert.match(html, /На проверке/);
  assert.match(html, /Отклонено: нечитаемый скриншот/);
  assert.match(html, /Закрыто/);
  assert.match(html, /welvura-stage--active/);
  assert.match(html, /welvura-progress__track/);
  assert.doesNotMatch(html, /без награды/);
  assert.doesNotMatch(html, /AZC/);
  assert.doesNotMatch(html, /Введите Welvura ID/);
});

test("rejected Stage 1 keeps 1 000 and the resubmit form", () => {
  const rejected: WelvuraState = {
    ...unbound,
    account: {
      state: "rejected",
      welvuraId: "WID",
      rejectionReason: "нечитаемый скриншот",
      rewardAzc: "1000",
    },
  };
  const html = renderToStaticMarkup(
    createElement(WelvuraChainView, {
      token: "fixture",
      skipRemote: true,
      initialState: rejected,
    }),
  );
  assert.match(html, /<span>1 000<\/span>/);
  assert.match(html, /нечитаемый скриншот/);
  assert.match(html, /Введите Welvura ID/);
  assert.match(html, /Отправить на проверку/);
  assert.doesNotMatch(html, /без награды/);
});
