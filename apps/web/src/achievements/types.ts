export type AchievementCode =
  | "kick_100_messages"
  | "referrals_5_active"
  | "games_100_total"
  | "cases_25_opened"
  | "level_10";

export type AchievementListItem = {
  code: AchievementCode;
  title: string;
  description: string;
  emoji: string;
  rewardAzc: string;
  current: number;
  target: number;
  progress: number;
  completed: boolean;
  unlockedAt: string | null;
};

export type AchievementsResponse = {
  items: AchievementListItem[];
};
