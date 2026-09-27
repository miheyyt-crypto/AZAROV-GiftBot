export type PaidCaseCode = "poor" | "medium" | "blatnoy";
export type PaidCaseRewardType = "azc" | "cash_rub";

export type PaidCaseCatalogItem = {
  itemCode: string;
  title: string;
  rewardType: PaidCaseRewardType;
  rewardAmount: string;
  realChance: string;
  displayChance: string | null;
  imageKey: string;
};

export type PaidCaseCatalog = {
  code: PaidCaseCode;
  title: string;
  priceAzc: string;
  items: PaidCaseCatalogItem[];
};

export type PaidCaseOpenResult = {
  openingId: string;
  caseCode: PaidCaseCode;
  priceAzc: string;
  result: {
    itemCode: string;
    title: string;
    rewardType: PaidCaseRewardType;
    rewardAmount?: string;
    rewardAmountRub?: string;
    inventoryItemId?: string;
    realChance: string;
    displayChance: string | null;
    imageKey: string;
  };
  balances: { azc: string };
  replayed?: boolean;
};
