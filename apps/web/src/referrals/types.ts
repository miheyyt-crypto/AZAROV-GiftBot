export type ReferralMeSummary = {
  referralUrl: string;
  token: string;
  stats: {
    invited: number;
    active: number;
    earnedAzc: string;
  };
  caseProgress: {
    current: number;
    target: number;
    availableCases: number;
    totalCasesEarned: number;
  };
};

export type ReferralListItem = {
  id: string;
  status: "attributed" | "activated";
  statusLabel: string;
  username: string | null;
  publicId: string | null;
  avatarUrl: string | null;
  attributedAt: string;
  activatedAt: string | null;
};

export type ReferralListResponse = {
  items: ReferralListItem[];
  nextCursor: string | null;
};

export const EMPTY_REFERRAL_ME: ReferralMeSummary = {
  referralUrl: "",
  token: "",
  stats: { invited: 0, active: 0, earnedAzc: "0" },
  caseProgress: {
    current: 0,
    target: 5,
    availableCases: 0,
    totalCasesEarned: 0,
  },
};

export const EMPTY_REFERRAL_LIST: ReferralListResponse = {
  items: [],
  nextCursor: null,
};

export const REFERRAL_STEPS = [
  "Пригласи друга",
  "Друг привязывает Kick",
  "Собирай активных друзей",
  "Кейс тебе",
] as const;

export const REFERRAL_BENEFITS = [
  "+1 000 тебе",
  "+1 000 другу",
  "Кейс каждые 5 активных",
] as const;
