export type LeaderboardMetric = "azc" | "friends";

export type LeaderboardRow = {
  place: number;
  username: string;
  valueLabel: string;
  valueKind: LeaderboardMetric;
  isYou: boolean;
  avatarUrl?: string | null;
};

export function podiumSlots(ranks: LeaderboardRow[]): {
  first: LeaderboardRow | undefined;
  second: LeaderboardRow | undefined;
  third: LeaderboardRow | undefined;
} {
  const byPlace = (place: number) => ranks.find((row) => row.place === place);
  return {
    first: byPlace(1),
    second: byPlace(2),
    third: byPlace(3),
  };
}

export function listAndPin(ranks: LeaderboardRow[], self: LeaderboardRow | undefined) {
  const rest = ranks.filter((row) => row.place > 3);
  const pin = self && self.place > 3 ? self : undefined;
  return {
    rest: pin
      ? rest.filter((row) => row.place !== pin.place && !row.isYou)
      : rest,
    pin,
  };
}
