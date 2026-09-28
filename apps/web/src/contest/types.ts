export type ReferralContestPublicStatus =
  | "scheduled"
  | "active"
  | "ended"
  | "finalized";

export type ReferralContestPrize = {
  place: number;
  rewardAzc: string;
};

export type ReferralContestHomeContest = {
  id: string;
  status: ReferralContestPublicStatus;
  startAt: string;
  endAt: string;
  prizes: ReferralContestPrize[];
  serverNow: string;
};

export type ReferralContestLeaderboardEntry = {
  rank: number;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  referralCount: number;
  isYou: boolean;
};

export type ReferralContestMe = {
  rank: number;
  referralCount: number;
  potentialRewardAzc: string | null;
  referralUrl: string | null;
};

export type ReferralContestHomeSummary = {
  contest: ReferralContestHomeContest | null;
  leaderboard: ReferralContestLeaderboardEntry[];
  me: ReferralContestMe;
  serverNow: string;
};
