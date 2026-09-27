import type {
  BalanceLeaderboardEntry,
  BalanceLeaderboardResponse,
  ReferralLeaderboardEntry,
  ReferralLeaderboardResponse,
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

function displayName(row: {
  displayName: string | null;
  username: string | null;
  publicId: string | null;
}): string {
  return row.displayName || row.username || row.publicId || "Игрок";
}

function parseBalanceEntry(value: unknown): BalanceLeaderboardEntry {
  if (!isRecord(value)) {
    throw new Error("invalid balance leaderboard entry");
  }
  return {
    rank: readNumber(value.rank),
    publicId: readNullableString(value.publicId),
    displayName: readNullableString(value.displayName),
    username: readNullableString(value.username),
    avatarUrl:
      value.avatarUrl === undefined ? null : readNullableString(value.avatarUrl),
    balanceAzc: readString(value.balanceAzc),
    isYou: value.isYou === true,
  };
}

function parseReferralEntry(value: unknown): ReferralLeaderboardEntry {
  if (!isRecord(value)) {
    throw new Error("invalid referral leaderboard entry");
  }
  return {
    rank: readNumber(value.rank),
    publicId: readNullableString(value.publicId),
    displayName: readNullableString(value.displayName),
    username: readNullableString(value.username),
    avatarUrl:
      value.avatarUrl === undefined ? null : readNullableString(value.avatarUrl),
    activeReferrals: readNumber(value.activeReferrals),
    isYou: value.isYou === true,
  };
}

export function parseBalanceLeaderboard(
  value: unknown,
): BalanceLeaderboardResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid balance leaderboard");
  }
  return {
    items: value.items.map(parseBalanceEntry),
    self:
      value.self === null || value.self === undefined
        ? null
        : parseBalanceEntry(value.self),
    ...(typeof value.serverTime === "string"
      ? { serverTime: value.serverTime }
      : {}),
  };
}

export function parseReferralLeaderboard(
  value: unknown,
): ReferralLeaderboardResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid referral leaderboard");
  }
  return {
    items: value.items.map(parseReferralEntry),
    self:
      value.self === null || value.self === undefined
        ? null
        : parseReferralEntry(value.self),
    ...(typeof value.serverTime === "string"
      ? { serverTime: value.serverTime }
      : {}),
  };
}

export function leaderboardDisplayName(row: {
  displayName: string | null;
  username: string | null;
  publicId: string | null;
}): string {
  return displayName(row);
}
