export type LeaderboardTab = "balance" | "referral" | "boss";

export type MockRank = {
  place: number;
  username: string;
  valueLabel: string;
  isYou?: boolean;
};

function ranks(prefix: string, unit: string): MockRank[] {
  return Array.from({ length: 100 }, (_, index) => {
    const place = index + 1;
    return {
      place,
      username: place === 17 ? "Bushman" : `${prefix}${place}`,
      valueLabel: `${Math.max(50, 20000 - place * 137)} ${unit}`,
      ...(place === 17 ? { isYou: true } : {}),
    };
  });
}

export const MOCK_BALANCE_RANKS = ranks("azc", "AZC");
export const MOCK_REFERRAL_RANKS = ranks("ref", "друзей");
export const MOCK_SELF_PLACE = 17;
