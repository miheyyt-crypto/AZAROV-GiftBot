import type {
  TaskCategory,
  TaskCode,
  TaskListItem,
  TaskUserState,
  TasksResponse,
  WelvuraAccountState,
  WelvuraStageState,
  WelvuraState,
  AdminWelvuraAccountItem,
  AdminWelvuraDepositItem,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("invalid nullable string");
  }
  return value;
}

const TASK_CODES = new Set<TaskCode>([
  "kick_nickname_tag",
  "kick_link",
  "kick_follow_azarov7777",
  "telegram_subscribe_azarov222",
  "telegram_bot_started",
  "referral_3_active",
]);

const CATEGORIES = new Set<TaskCategory | "all">([
  "all",
  "kick",
  "tg",
  "social",
  "partners",
]);

const TASK_STATES = new Set<TaskUserState>([
  "available",
  "completed",
  "requirement_not_met",
  "verification_unavailable",
]);

const ACCOUNT_STATES = new Set<WelvuraAccountState>([
  "not_submitted",
  "pending",
  "approved",
  "rejected",
]);

const STAGE_STATES = new Set<WelvuraStageState>([
  "locked",
  "available",
  "pending",
  "approved",
  "rejected",
]);

export function parseTasksResponse(value: unknown): TasksResponse {
  if (!isRecord(value) || !Array.isArray(value.categories) || !Array.isArray(value.tasks)) {
    throw new Error("invalid tasks response");
  }
  return {
    categories: value.categories.map((row) => {
      if (!isRecord(row)) {
        throw new Error("invalid category");
      }
      const id = readString(row.id, "category.id");
      if (!CATEGORIES.has(id as TaskCategory | "all")) {
        throw new Error("invalid category id");
      }
      return { id: id as TaskCategory | "all", label: readString(row.label, "label") };
    }),
    tasks: value.tasks.map((row) => {
      if (!isRecord(row)) {
        throw new Error("invalid task");
      }
      const code = readString(row.code, "task.code");
      if (!TASK_CODES.has(code as TaskCode)) {
        throw new Error("invalid task code");
      }
      const category = readString(row.category, "task.category");
      if (!CATEGORIES.has(category as TaskCategory) || category === "all") {
        throw new Error("invalid task category");
      }
      const state = readString(row.state, "task.state");
      if (!TASK_STATES.has(state as TaskUserState)) {
        throw new Error("invalid task state");
      }
      const item: TaskListItem = {
        code: code as TaskCode,
        title: readString(row.title, "title"),
        description: readString(row.description, "description"),
        category: category as TaskCategory,
        rewardAzc: readString(row.rewardAzc, "rewardAzc"),
        state: state as TaskUserState,
        completedAt: readNullableString(row.completedAt),
      };
      if (typeof row.actionHint === "string") {
        item.actionHint = row.actionHint;
      }
      return item;
    }),
  };
}

export function parseWelvuraState(value: unknown): WelvuraState {
  if (!isRecord(value) || !isRecord(value.account) || !isRecord(value.policy) || !isRecord(value.progress) || !Array.isArray(value.stages)) {
    throw new Error("invalid welvura state");
  }
  const accountState = readString(value.account.state, "account.state");
  if (!ACCOUNT_STATES.has(accountState as WelvuraAccountState)) {
    throw new Error("invalid account state");
  }
  return {
    account: {
      state: accountState as WelvuraAccountState,
      welvuraId: readNullableString(value.account.welvuraId),
      rejectionReason: readNullableString(value.account.rejectionReason),
      rewardAzc: readString(value.account.rewardAzc, "account.rewardAzc"),
    },
    policy: {
      depositsFrom: readString(value.policy.depositsFrom, "depositsFrom"),
      oneDepositOneStage: value.policy.oneDepositOneStage === true,
    },
    progress: {
      completedStages: Number(value.progress.completedStages ?? 0),
      totalStages: Number(value.progress.totalStages ?? 13),
    },
    stages: value.stages.map((row) => {
      if (!isRecord(row)) {
        throw new Error("invalid stage");
      }
      const state = readString(row.state, "stage.state");
      if (!STAGE_STATES.has(state as WelvuraStageState)) {
        throw new Error("invalid stage state");
      }
      return {
        stageNumber: Number(row.stageNumber),
        requiredDepositRub: readString(row.requiredDepositRub, "requiredDepositRub"),
        rewardAzc: readString(row.rewardAzc, "rewardAzc"),
        instruction: readString(row.instruction, "instruction"),
        state: state as WelvuraStageState,
        rejectionReason: readNullableString(row.rejectionReason),
      };
    }),
  };
}

export function parseAdminWelvuraAccounts(value: unknown): {
  items: AdminWelvuraAccountItem[];
} {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid account queue");
  }
  return {
    items: value.items.map((row) => {
      if (!isRecord(row) || !isRecord(row.screenshot)) {
        throw new Error("invalid account item");
      }
      return {
        id: readString(row.id, "id"),
        publicId: readString(row.publicId, "publicId"),
        username: readNullableString(row.username),
        welvuraId: readString(row.welvuraId, "welvuraId"),
        attemptNumber: Number(row.attemptNumber),
        status: readString(row.status, "status"),
        submittedAt: readString(row.submittedAt, "submittedAt"),
        rejectionReason: readNullableString(row.rejectionReason),
        screenshot: {
          fileId: readString(row.screenshot.fileId, "fileId"),
          contentType: readString(row.screenshot.contentType, "contentType"),
        },
      };
    }),
  };
}

export function parseAdminWelvuraDeposits(value: unknown): {
  items: AdminWelvuraDepositItem[];
} {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid deposit queue");
  }
  return {
    items: value.items.map((row) => {
      if (!isRecord(row) || !isRecord(row.screenshot)) {
        throw new Error("invalid deposit item");
      }
      return {
        id: readString(row.id, "id"),
        publicId: readString(row.publicId, "publicId"),
        username: readNullableString(row.username),
        welvuraId: readString(row.welvuraId, "welvuraId"),
        stageNumber: Number(row.stageNumber),
        attemptNumber: Number(row.attemptNumber),
        requiredDepositRub: readString(row.requiredDepositRub, "requiredDepositRub"),
        rewardAzc: readString(row.rewardAzc, "rewardAzc"),
        status: readString(row.status, "status"),
        submittedAt: readString(row.submittedAt, "submittedAt"),
        rejectionReason: readNullableString(row.rejectionReason),
        policyFrom: readString(row.policyFrom, "policyFrom"),
        screenshot: {
          fileId: readString(row.screenshot.fileId, "fileId"),
          contentType: readString(row.screenshot.contentType, "contentType"),
        },
      };
    }),
  };
}
