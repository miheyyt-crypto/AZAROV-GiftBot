import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWelvuraPreview,
  isWelvuraPreviewEnabled,
  readWelvuraPreview,
} from "./welvura-preview.js";
import type { WelvuraState } from "./types.js";

const DEV = { nodeEnv: "development", allowDevAuth: true };
const PROD = { nodeEnv: "production", allowDevAuth: true };
const NO_FLAG = { nodeEnv: "development", allowDevAuth: false };

const state: WelvuraState = {
  account: {
    state: "pending",
    welvuraId: "WID-real",
    rejectionReason: null,
    rewardAzc: "1000",
  },
  policy: { depositsFrom: "2026-09-11", oneDepositOneStage: true },
  progress: { completedStages: 0, totalStages: 13 },
  stages: [
    {
      stageNumber: 1,
      requiredDepositRub: "100",
      rewardAzc: "2000",
      instruction: "Пополни счёт на 100 ₽",
      state: "locked",
      rejectionReason: null,
    },
    {
      stageNumber: 2,
      requiredDepositRub: "1000",
      rewardAzc: "3000",
      instruction: "Пополни счёт на 1000 ₽",
      state: "locked",
      rejectionReason: null,
    },
  ],
};

test("welvura preview is impossible in production even with ALLOW_DEV_AUTH", () => {
  assert.equal(isWelvuraPreviewEnabled(PROD), false);
  assert.equal(
    readWelvuraPreview("?dev=user&welvuraPreview=available", PROD),
    undefined,
  );
  assert.equal(
    readWelvuraPreview("?dev=user&welvuraPreview=available", NO_FLAG),
    undefined,
  );
});

test("welvura preview requires local dev role and known mode", () => {
  assert.equal(readWelvuraPreview("?welvuraPreview=available", DEV), undefined);
  assert.equal(
    readWelvuraPreview("?dev=user&welvuraPreview=available", DEV),
    "available",
  );
  assert.equal(
    readWelvuraPreview("?dev=user&welvuraPreview=pending", DEV),
    "pending",
  );
});

test("applyWelvuraPreview is presentation-only and keeps catalog rewards", () => {
  const available = applyWelvuraPreview(state, "available");
  assert.equal(available.account.state, "not_submitted");
  assert.equal(available.account.rewardAzc, "1000");
  assert.equal(state.account.state, "pending");
  assert.equal(available.stages[0]?.rewardAzc, "2000");
  assert.equal(available.stages[1]?.rewardAzc, "3000");
  assert.ok(available.stages.every((row) => row.state === "locked"));

  const pending = applyWelvuraPreview(state, "pending");
  assert.equal(pending.account.state, "pending");
  assert.equal(pending.account.rewardAzc, "1000");

  const approved = applyWelvuraPreview(state, "approved");
  assert.equal(approved.account.state, "approved");
  assert.equal(approved.account.rewardAzc, "1000");
  assert.equal(approved.stages[0]?.state, "available");
  assert.equal(approved.stages[1]?.state, "locked");
  assert.equal(approved.stages[0]?.rewardAzc, "2000");
});
