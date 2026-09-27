export type FreeCaseRarity = "legendary" | "epic" | "common";
export type FreeCaseRewardType = "azc" | "gram" | "external";

export type FreeCaseCatalogItem = {
  itemCode: string;
  title: string;
  rarity: FreeCaseRarity;
  rewardType: FreeCaseRewardType;
  displayChance: string;
  imageKey: string;
};

export type FreeCaseStatus = {
  caseCode: "free";
  available: boolean;
  nextAvailableAt: string | null;
  remainingSeconds: number;
  displayTotals: {
    legendary: string;
    epic: string;
    common: string;
  };
  catalog: FreeCaseCatalogItem[];
  lastOpening: {
    openingId: string;
    itemCode: string;
    title: string;
    rarity: FreeCaseRarity;
    openedAt: string;
  } | null;
};

export type FreeCaseOpenResult = {
  openingId: string;
  caseCode: "free";
  result: {
    itemCode: string;
    title: string;
    rarity: FreeCaseRarity;
    rewardType: FreeCaseRewardType;
    displayChance: string;
    realChance: string;
    imageKey: string;
  };
  nextAvailableAt: string;
  balances: { azc: string; gram: string };
  replayed?: boolean;
};

export type RecentWin = {
  id: string;
  source: string;
  username: string | null;
  displayName: string | null;
  publicId: string | null;
  avatarUrl?: string | null;
  title: string;
  rewardLabel: string;
  itemCode: string;
  rarity: FreeCaseRarity | null;
  realChance: string | null;
  createdAt: string;
  payoutAzc?: string;
};
