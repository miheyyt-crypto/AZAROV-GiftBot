import {
  runLoadSmoke,
  SMOKE_USERS,
  SMOKE_WEBHOOK_BURST,
  type LoadReport,
} from "@giftbot/loadtest";
import {
  assertChecklistClosed,
  evaluateChecklist,
  type ChecklistItem,
} from "./checklist.js";
import { assertAllPendingFlaggedOff, PENDING_GO_LIVE_FLAGS } from "./pending.js";

export type ValidationReport = {
  process: "validate";
  closed: true;
  productionReadyClaim: false;
  pendingFlags: typeof PENDING_GO_LIVE_FLAGS;
  checklist: ChecklistItem[];
  loadSmoke: {
    users: number;
    webhookBurst: number;
    blockers: string[];
    productionReadyClaim: false;
  };
};

export async function runValidation(): Promise<ValidationReport> {
  assertAllPendingFlaggedOff();
  const checklist = await evaluateChecklist();
  assertChecklistClosed(checklist);
  const smoke: LoadReport = await runLoadSmoke();
  if (smoke.blockers.length > 0) {
    throw new Error(`load smoke blockers: ${smoke.blockers.join("; ")}`);
  }
  if (smoke.productionReadyClaim !== false) {
    throw new Error("validation must not claim production-ready");
  }

  return {
    process: "validate",
    closed: true,
    productionReadyClaim: false,
    pendingFlags: PENDING_GO_LIVE_FLAGS,
    checklist,
    loadSmoke: {
      users: SMOKE_USERS,
      webhookBurst: SMOKE_WEBHOOK_BURST,
      blockers: smoke.blockers,
      productionReadyClaim: false,
    },
  };
}
