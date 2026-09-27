import type {
  ReferralCaseCatalog,
  ReferralCaseCatalogItem,
  ReferralCaseOpenResult,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("expected string");
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return readString(value);
}

function readNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("expected number");
  }
  return value;
}

function readRewardType(value: unknown): "azc" | "cash_rub" {
  if (value === "azc" || value === "cash_rub") {
    return value;
  }
  throw new Error("invalid reward type");
}

function parseCatalogItem(value: unknown): ReferralCaseCatalogItem {
  if (!isRecord(value)) {
    throw new Error("invalid catalog item");
  }
  return {
    itemCode: readString(value.itemCode),
    title: readString(value.title),
    rewardType: readRewardType(value.rewardType),
    rewardAmount: readString(value.rewardAmount),
    displayChance: readNullableString(value.displayChance),
    imageKey: readString(value.imageKey),
  };
}

export function parseReferralCaseCatalog(value: unknown): ReferralCaseCatalog {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid referral case catalog");
  }
  if (value.code !== "referral") {
    throw new Error("invalid referral case code");
  }
  return {
    code: "referral",
    title: readString(value.title),
    priceAzc: null,
    requiresEntitlement: true,
    availableCases: readNumber(value.availableCases),
    items: value.items.map(parseCatalogItem),
  };
}

export function parseReferralCaseOpenResult(
  value: unknown,
): ReferralCaseOpenResult {
  if (!isRecord(value)) {
    throw new Error("invalid open result");
  }
  if (!isRecord(value.result) || !isRecord(value.balances)) {
    throw new Error("invalid open result shape");
  }
  if (value.caseCode !== "referral") {
    throw new Error("invalid referral case code");
  }
  const rewardType = readRewardType(value.result.rewardType);
  const result: ReferralCaseOpenResult["result"] = {
    itemCode: readString(value.result.itemCode),
    title: readString(value.result.title),
    rewardType,
    realChance: readString(value.result.realChance),
    displayChance: readNullableString(value.result.displayChance),
    imageKey: readString(value.result.imageKey),
  };
  if (typeof value.result.rewardAmount === "string") {
    result.rewardAmount = value.result.rewardAmount;
  }
  if (typeof value.result.rewardAmountRub === "string") {
    result.rewardAmountRub = value.result.rewardAmountRub;
  }
  if (typeof value.result.inventoryItemId === "string") {
    result.inventoryItemId = value.result.inventoryItemId;
  }
  return {
    openingId: readString(value.openingId),
    caseCode: "referral",
    result,
    balances: { azc: readString(value.balances.azc) },
    availableCases: readNumber(value.availableCases),
    ...(typeof value.replayed === "boolean" ? { replayed: value.replayed } : {}),
  };
}
