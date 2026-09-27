export type ReferralContestPublicStatus =
  | "scheduled"
  | "active"
  | "ended"
  | "finalized";

export type ReferralContestPrize = {
  place: number;
  rewardAzc: string;
};

export type ReferralContestPublic = {
  id: string;
  status: ReferralContestPublicStatus;
  title: string;
  startAt: string;
  endAt: string;
  prizePoolAzc: string;
  prizePlaces: number;
  prizes: ReferralContestPrize[];
  finalizedAt: string | null;
};

export type ReferralContestHomeSummary = {
  id: string;
  status: ReferralContestPublicStatus;
  title: string;
  startAt: string;
  endAt: string;
  prizePoolAzc: string;
  prizePlaces: number;
  serverNow: string;
};

export type ReferralContestLeaderboardEntry = {
  rank: number;
  publicId: string | null;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  referralCount: number;
  prizePlace: number | null;
  rewardAzc: string | null;
  isYou: boolean;
};

export type ReferralContestMe = {
  rank: number;
  referralCount: number;
  nextRankGap: number;
  prizePlace: number | null;
  potentialRewardAzc: string | null;
  referralUrl: string | null;
};

export type ReferralContestPage = {
  contest: ReferralContestPublic | null;
  leaderboard: ReferralContestLeaderboardEntry[];
  me: ReferralContestMe | null;
  serverNow: string;
};

export type AdminReferralContestListItem = ReferralContestPublic & {
  participantCount: number;
  top10: ReferralContestLeaderboardEntry[];
};

export type AdminReferralContestList = {
  items: AdminReferralContestListItem[];
  serverNow: string;
};

export type AdminReferralContestDetail = {
  contest: ReferralContestPublic;
  participantCount: number;
  leaderboard: ReferralContestLeaderboardEntry[];
  winners: ReferralContestLeaderboardEntry[];
  serverNow: string;
};
