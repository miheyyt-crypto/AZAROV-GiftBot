import type { BalanceLeaderboardEntry } from "./types.js";

export function homePodiumSlots(top3: BalanceLeaderboardEntry[]): {
  first: BalanceLeaderboardEntry | undefined;
  second: BalanceLeaderboardEntry | undefined;
  third: BalanceLeaderboardEntry | undefined;
} {
  const byRank = (rank: number) => top3.find((row) => row.rank === rank);
  return {
    first: byRank(1),
    second: byRank(2),
    third: byRank(3),
  };
}
