import type {
  AchievementCode,
  AchievementListItem,
  AchievementsResponse,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("invalid nullable string");
  }
  return value;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

const CODES = new Set<AchievementCode>([
  "kick_100_messages",
  "referrals_5_active",
  "games_100_total",
  "cases_25_opened",
  "level_10",
]);

export function parseAchievementItem(value: unknown): AchievementListItem {
  if (!isRecord(value)) {
    throw new Error("invalid achievement");
  }
  const code = readString(value.code, "code");
  if (!CODES.has(code as AchievementCode)) {
    throw new Error("invalid achievement code");
  }
  return {
    code: code as AchievementCode,
    title: readString(value.title, "title"),
    description: readString(value.description, "description"),
    emoji: readString(value.emoji, "emoji"),
    rewardAzc: readString(value.rewardAzc, "rewardAzc"),
    current: readNumber(value.current, "current"),
    target: readNumber(value.target, "target"),
    progress: readNumber(value.progress, "progress"),
    completed: value.completed === true,
    unlockedAt: readNullableString(value.unlockedAt),
  };
}

export function parseAchievementsResponse(value: unknown): AchievementsResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid achievements response");
  }
  return {
    items: value.items.map(parseAchievementItem),
  };
}
