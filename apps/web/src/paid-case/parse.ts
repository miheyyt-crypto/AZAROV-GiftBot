import type {
  PaidCaseCatalog,
  PaidCaseCatalogItem,
  PaidCaseCode,
  PaidCaseOpenResult,
  PaidCaseRewardType,
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

function readCaseCode(value: unknown): PaidCaseCode {
  if (value === "poor" || value === "medium" || value === "blatnoy") {
    return value;
  }
  throw new Error("invalid paid case code");
}

function readRewardType(value: unknown): PaidCaseRewardType {
  if (value === "azc" || value === "cash_rub") {
    return value;
  }
  throw new Error("invalid reward type");
}

function parseCatalogItem(value: unknown): PaidCaseCatalogItem {
  if (!isRecord(value)) {
    throw new Error("invalid catalog item");
  }
  return {
    itemCode: readString(value.itemCode),
    title: readString(value.title),
    rewardType: readRewardType(value.rewardType),
    rewardAmount: readString(value.rewardAmount),
    realChance: readString(value.realChance),
    displayChance: readNullableString(value.displayChance),
    imageKey: readString(value.imageKey),
  };
}

function parseCatalogEntry(value: unknown): PaidCaseCatalog {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid paid case catalog entry");
  }
  return {
    code: readCaseCode(value.code),
    title: readString(value.title),
    priceAzc: readString(value.priceAzc),
    items: value.items.map(parseCatalogItem),
  };
}

export function parsePaidCaseCatalog(value: unknown): PaidCaseCatalog[] {
  if (Array.isArray(value)) {
    return value.map(parseCatalogEntry);
  }
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid paid case catalog");
  }
  return value.items.map(parseCatalogEntry);
}

export function parsePaidCaseOpenResult(value: unknown): PaidCaseOpenResult {
  if (!isRecord(value)) {
    throw new Error("invalid open result");
  }
  if (!isRecord(value.result) || !isRecord(value.balances)) {
    throw new Error("invalid open result shape");
  }
  const rewardType = readRewardType(value.result.rewardType);
  const result: PaidCaseOpenResult["result"] = {
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
    caseCode: readCaseCode(value.caseCode),
    priceAzc: readString(value.priceAzc),
    result,
    balances: {
      azc: readString(value.balances.azc),
    },
    ...(typeof value.replayed === "boolean" ? { replayed: value.replayed } : {}),
  };
}
