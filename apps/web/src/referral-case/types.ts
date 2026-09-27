export type ReferralCaseCatalogItem = {
  itemCode: string;
  title: string;
  rewardType: "azc" | "cash_rub";
  rewardAmount: string;
  displayChance: string | null;
  imageKey: string;
};

export type ReferralCaseCatalog = {
  code: "referral";
  title: string;
  priceAzc: null;
  requiresEntitlement: true;
  availableCases: number;
  items: ReferralCaseCatalogItem[];
};

export type ReferralCaseOpenResult = {
  openingId: string;
  caseCode: "referral";
  result: {
    itemCode: string;
    title: string;
    rewardType: "azc" | "cash_rub";
    rewardAmount?: string;
    rewardAmountRub?: string;
    inventoryItemId?: string;
    realChance: string;
    displayChance: string | null;
    imageKey: string;
  };
  balances: { azc: string };
  availableCases: number;
  replayed?: boolean;
};
