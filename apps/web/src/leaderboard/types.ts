export type LeaderboardTab = "balance" | "referral" | "boss";

export type BalanceLeaderboardEntry = {
  rank: number;
  publicId: string | null;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  balanceAzc: string;
  isYou: boolean;
};

export type BalanceLeaderboardResponse = {
  items: BalanceLeaderboardEntry[];
  self: BalanceLeaderboardEntry | null;
  serverTime?: string;
};

export type ReferralLeaderboardEntry = {
  rank: number;
  publicId: string | null;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  activeReferrals: number;
  isYou: boolean;
};

export type ReferralLeaderboardResponse = {
  items: ReferralLeaderboardEntry[];
  self: ReferralLeaderboardEntry | null;
  serverTime?: string;
};

export const EMPTY_BALANCE_LEADERBOARD: BalanceLeaderboardResponse = {
  items: [],
  self: null,
};

export const EMPTY_REFERRAL_LEADERBOARD: ReferralLeaderboardResponse = {
  items: [],
  self: null,
};

export type RankRow = {
  place: number;
  username: string;
  valueLabel: string;
  isYou?: boolean;
};
