export type TaskCategory = "kick" | "tg" | "social" | "partners";

export type TaskCode =
  | "kick_nickname_tag"
  | "kick_link"
  | "kick_follow_azarov7777"
  | "telegram_subscribe_azarov222"
  | "telegram_bot_started"
  | "referral_3_active";

export type TaskUserState =
  | "available"
  | "completed"
  | "requirement_not_met"
  | "verification_unavailable";

export type TaskListItem = {
  code: TaskCode;
  title: string;
  description: string;
  category: TaskCategory;
  rewardAzc: string;
  state: TaskUserState;
  completedAt: string | null;
  actionHint?: string;
};

export type TasksResponse = {
  categories: Array<{ id: TaskCategory | "all"; label: string }>;
  tasks: TaskListItem[];
};

export type WelvuraAccountState =
  | "not_submitted"
  | "pending"
  | "approved"
  | "rejected";

export type WelvuraStageState =
  | "locked"
  | "available"
  | "pending"
  | "approved"
  | "rejected";

export type WelvuraState = {
  account: {
    state: WelvuraAccountState;
    welvuraId: string | null;
    rejectionReason: string | null;
    rewardAzc: string;
  };
  policy: {
    depositsFrom: string;
    oneDepositOneStage: boolean;
  };
  progress: {
    completedStages: number;
    totalStages: number;
  };
  stages: Array<{
    stageNumber: number;
    requiredDepositRub: string;
    rewardAzc: string;
    instruction: string;
    state: WelvuraStageState;
    rejectionReason: string | null;
  }>;
};

export type AdminWelvuraAccountItem = {
  id: string;
  publicId: string;
  username: string | null;
  welvuraId: string;
  attemptNumber: number;
  status: string;
  submittedAt: string;
  rejectionReason: string | null;
  screenshot: { fileId: string; contentType: string };
};

export type AdminWelvuraDepositItem = {
  id: string;
  publicId: string;
  username: string | null;
  welvuraId: string;
  stageNumber: number;
  attemptNumber: number;
  requiredDepositRub: string;
  rewardAzc: string;
  status: string;
  submittedAt: string;
  rejectionReason: string | null;
  policyFrom: string;
  screenshot: { fileId: string; contentType: string };
};
