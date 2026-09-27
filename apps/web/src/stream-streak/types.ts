export type StreamStreakState = {
  currentStreak: number;
  completed: boolean;
  nextTarget: number | null;
  nextRewardAzc: string | null;
  freezeCount: number;
  stream:
    | {
        isLive: true;
        sessionId: string;
        messages: number;
        requiredMessages: number;
        qualified: boolean;
      }
    | { isLive: false };
};

export const EMPTY_STREAM_STREAK: StreamStreakState = {
  currentStreak: 0,
  completed: false,
  nextTarget: 1,
  nextRewardAzc: "100",
  freezeCount: 0,
  stream: { isLive: false },
};
