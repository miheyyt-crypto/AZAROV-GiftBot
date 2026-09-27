import type {
  FreeCaseCatalogItem,
  FreeCaseOpenResult,
  FreeCaseRarity,
  FreeCaseRewardType,
  FreeCaseStatus,
  RecentWin,
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

function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("expected boolean");
  }
  return value;
}

function readRarity(value: unknown): FreeCaseRarity {
  if (value === "legendary" || value === "epic" || value === "common") {
    return value;
  }
  throw new Error("invalid rarity");
}

function readNullableRarity(value: unknown): FreeCaseRarity | null {
  if (value === null) {
    return null;
  }
  return readRarity(value);
}

function readRewardType(value: unknown): FreeCaseRewardType {
  if (value === "azc" || value === "gram" || value === "external") {
    return value;
  }
  throw new Error("invalid reward type");
}

function parseCatalogItem(value: unknown): FreeCaseCatalogItem {
  if (!isRecord(value)) {
    throw new Error("invalid catalog item");
  }
  return {
    itemCode: readString(value.itemCode),
    title: readString(value.title),
    rarity: readRarity(value.rarity),
    rewardType: readRewardType(value.rewardType),
    displayChance: readString(value.displayChance),
    imageKey: readString(value.imageKey),
  };
}

export function parseFreeCaseStatus(value: unknown): FreeCaseStatus {
  if (!isRecord(value)) {
    throw new Error("invalid free case status");
  }
  if (value.caseCode !== "free") {
    throw new Error("invalid case code");
  }
  if (!isRecord(value.displayTotals)) {
    throw new Error("invalid display totals");
  }
  if (!Array.isArray(value.catalog)) {
    throw new Error("invalid catalog");
  }
  let lastOpening: FreeCaseStatus["lastOpening"] = null;
  if (value.lastOpening !== null && value.lastOpening !== undefined) {
    if (!isRecord(value.lastOpening)) {
      throw new Error("invalid last opening");
    }
    lastOpening = {
      openingId: readString(value.lastOpening.openingId),
      itemCode: readString(value.lastOpening.itemCode),
      title: readString(value.lastOpening.title),
      rarity: readRarity(value.lastOpening.rarity),
      openedAt: readString(value.lastOpening.openedAt),
    };
  }
  return {
    caseCode: "free",
    available: readBoolean(value.available),
    nextAvailableAt: readNullableString(value.nextAvailableAt),
    remainingSeconds: readNumber(value.remainingSeconds),
    displayTotals: {
      legendary: readString(value.displayTotals.legendary),
      epic: readString(value.displayTotals.epic),
      common: readString(value.displayTotals.common),
    },
    catalog: value.catalog.map(parseCatalogItem),
    lastOpening,
  };
}

export function parseFreeCaseOpenResult(value: unknown): FreeCaseOpenResult {
  if (!isRecord(value)) {
    throw new Error("invalid open result");
  }
  if (!isRecord(value.result) || !isRecord(value.balances)) {
    throw new Error("invalid open result shape");
  }
  if (value.caseCode !== "free") {
    throw new Error("invalid case code");
  }
  return {
    openingId: readString(value.openingId),
    caseCode: "free",
    result: {
      itemCode: readString(value.result.itemCode),
      title: readString(value.result.title),
      rarity: readRarity(value.result.rarity),
      rewardType: readRewardType(value.result.rewardType),
      displayChance: readString(value.result.displayChance),
      realChance: readString(value.result.realChance),
      imageKey: readString(value.result.imageKey),
    },
    nextAvailableAt: readString(value.nextAvailableAt),
    balances: {
      azc: readString(value.balances.azc),
      gram: readString(value.balances.gram),
    },
    ...(typeof value.replayed === "boolean" ? { replayed: value.replayed } : {}),
  };
}

export function parseRecentWins(value: unknown): { items: RecentWin[] } {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid recent wins");
  }
  return {
    items: value.items.map((item) => {
      if (!isRecord(item)) {
        throw new Error("invalid recent win");
      }
      const title = readString(item.title);
      const rewardLabel =
        typeof item.rewardLabel === "string" ? item.rewardLabel : title;
      return {
        id: readString(item.id),
        source: readString(item.source),
        username: readNullableString(item.username),
        displayName:
          item.displayName === undefined
            ? null
            : readNullableString(item.displayName),
        publicId: readNullableString(item.publicId),
        avatarUrl:
          item.avatarUrl === undefined ? null : readNullableString(item.avatarUrl),
        title,
        rewardLabel,
        itemCode: readString(item.itemCode),
        rarity: readNullableRarity(item.rarity),
        realChance:
          item.realChance === null || item.realChance === undefined
            ? null
            : readString(item.realChance),
        createdAt: readString(item.createdAt),
        ...(typeof item.payoutAzc === "string"
          ? { payoutAzc: item.payoutAzc }
          : {}),
      };
    }),
  };
}
