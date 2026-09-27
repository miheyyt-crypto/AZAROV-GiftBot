import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTasksResponse, parseWelvuraState } from "./parse.js";

test("parseTasksResponse accepts catalog payload", () => {
  const parsed = parseTasksResponse({
    categories: [{ id: "all", label: "ВСЕ" }],
    tasks: [
      {
        code: "kick_link",
        title: "Привязать Kick",
        description: "x",
        category: "kick",
        rewardAzc: "400",
        state: "available",
        completedAt: null,
      },
    ],
  });
  assert.equal(parsed.tasks[0]?.rewardAzc, "400");
});

test("parseWelvuraState accepts progress payload", () => {
  const parsed = parseWelvuraState({
    account: {
      state: "approved",
      welvuraId: "WID",
      rejectionReason: null,
      rewardAzc: "1000",
    },
    policy: { depositsFrom: "2026-09-11", oneDepositOneStage: true },
    progress: { completedStages: 1, totalStages: 13 },
    stages: [
      {
        stageNumber: 1,
        requiredDepositRub: "100",
        rewardAzc: "2000",
        instruction: "x",
        state: "approved",
        rejectionReason: null,
      },
    ],
  });
  assert.equal(parsed.progress.completedStages, 1);
  assert.equal(parsed.account.rewardAzc, "1000");
});
