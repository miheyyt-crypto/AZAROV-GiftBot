import { groupDigits } from "../lib/format.js";
import type {
  FreeCaseCatalogItem,
  FreeCaseOpenResult,
  FreeCaseRewardType,
  FreeCaseStatus,
  RecentWin,
} from "./types.js";

export function catalogItemFromOpenResult(
  result: FreeCaseOpenResult["result"],
): FreeCaseCatalogItem {
  return {
    itemCode: result.itemCode,
    title: result.title,
    rarity: result.rarity,
    rewardType: result.rewardType,
    displayChance: result.displayChance,
    imageKey: result.imageKey,
  };
}

export function recentWinFromFreeCaseOpen(
  opened: FreeCaseOpenResult,
  openedAtIso = new Date().toISOString(),
): RecentWin {
  return {
    id: opened.openingId,
    source: "free_case",
    username: null,
    displayName: null,
    publicId: null,
    title: opened.result.title,
    rewardLabel: opened.result.title,
    itemCode: opened.result.itemCode,
    rarity: opened.result.rarity,
    realChance: opened.result.realChance,
    createdAt: openedAtIso,
  };
}

export function lastOpeningFromFreeCaseOpen(
  opened: FreeCaseOpenResult,
  openedAtIso = new Date().toISOString(),
): NonNullable<FreeCaseStatus["lastOpening"]> {
  return {
    openingId: opened.openingId,
    itemCode: opened.result.itemCode,
    title: opened.result.title,
    rarity: opened.result.rarity,
    openedAt: openedAtIso,
  };
}

export function freeCaseResultCreditLine(
  rewardType: FreeCaseRewardType,
): string {
  switch (rewardType) {
    case "azc":
      return "★ Монеты зачислены на баланс!";
    case "gram":
      return "★ Gram зачислен на баланс!";
    case "external":
      return "★ Награда добавлена в инвентарь!";
  }
}

export function friendlyFreeCaseError(code?: string): string {
  switch (code) {
    case "FREE_CASE_COOLDOWN_ACTIVE":
      return "Бесплатный кейс пока недоступен";
    case "FREE_CASE_NOT_AVAILABLE":
      return "Бесплатный кейс недоступен";
    case "FREE_CASE_OPEN_FAILED":
      return "Не удалось открыть кейс";
    default:
      return "Не удалось открыть кейс. Попробуйте ещё раз";
  }
}

export function rarityLabel(rarity: "legendary" | "epic" | "common"): string {
  switch (rarity) {
    case "legendary":
      return "Легендарные";
    case "epic":
      return "Эпические";
    case "common":
      return "Обычные";
  }
}

export function rarityHeading(rarity: "legendary" | "epic" | "common"): string {
  switch (rarity) {
    case "legendary":
      return "Легендарный";
    case "epic":
      return "Эпический";
    case "common":
      return "Обычный";
  }
}

export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function remainingFromServer(
  nextAvailableAt: string | null,
  remainingSecondsAtFetch: number,
  fetchedAtMs: number,
  nowMs: number,
): number {
  if (!nextAvailableAt) {
    return 0;
  }
  const elapsed = Math.max(0, Math.floor((nowMs - fetchedAtMs) / 1000));
  return Math.max(0, remainingSecondsAtFetch - elapsed);
}

export function recentWinSourceLabel(source: string): string {
  switch (source) {
    case "free_case":
      return "Бесплатный кейс";
    case "poor_case":
      return "Нищий кейс";
    case "medium_case":
      return "Средний кейс";
    case "blatnoy_case":
      return "Блатной кейс";
    case "referral_case":
      return "Реферальный кейс";
    case "mines":
      return "Mines";
    case "dice":
      return "Dice";
    case "rolls":
      return "Rolls";
    default:
      return source;
  }
}

/** Home recent-wins line: "Выиграл в …". */
export function recentWinActionLabel(source: string): string {
  switch (source) {
    case "free_case":
      return "Выиграл в бесплатном кейсе";
    case "poor_case":
      return "Выиграл в нищем кейсе";
    case "medium_case":
      return "Выиграл в среднем кейсе";
    case "blatnoy_case":
      return "Выиграл в блатном кейсе";
    case "referral_case":
      return "Выиграл в реферальном кейсе";
    case "mines":
      return "Выиграл в mines";
    case "dice":
      return "Выиграл в dice";
    case "rolls":
      return "Выиграл в roll";
    default:
      return `Выиграл в ${recentWinSourceLabel(source)}`;
  }
}

export function formatRelativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) {
    return "";
  }
  const deltaSec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (deltaSec < 60) {
    return "только что";
  }
  if (deltaSec < 3600) {
    return `${Math.floor(deltaSec / 60)} мин. назад`;
  }
  if (deltaSec < 86400) {
    return `${Math.floor(deltaSec / 3600)} ч. назад`;
  }
  return `${Math.floor(deltaSec / 86400)} дн. назад`;
}

export function formatRecentWinChance(realChance: string | null): string | null {
  if (realChance == null || realChance === "") {
    return null;
  }
  const n = Number(realChance);
  if (!Number.isFinite(n)) {
    return `Шанс ${realChance}%`;
  }
  const compact = Number.isInteger(n)
    ? String(n)
    : n.toFixed(2).replace(/\.?0+$/, "");
  return `Шанс ${compact}%`;
}

export function formatRecentWinReward(drop: {
  rewardLabel: string;
  title: string;
  itemCode?: string;
  payoutAzc?: string;
}): { kind: "azc" | "other"; label: string } {
  const raw = (drop.rewardLabel || drop.title).trim();
  const stripped = raw
    .replace(/^(dice|mines|rolls|roll)\s+/i, "")
    .replace(/^\+/, "")
    .trim();
  const looksLikeGram =
    drop.itemCode?.startsWith("gram-") === true ||
    /^([\d\s]+(?:[.,]\d+)?)\s*Gram$/i.test(stripped);
  if (looksLikeGram) {
    const gramMatch = stripped.match(/^([\d\s]+(?:[.,]\d+)?)\s*Gram$/i);
    return {
      kind: "other",
      label: gramMatch?.[1]
        ? `${groupDigits(gramMatch[1].replace(/\s/g, "").replace(",", "."))} Gram`
        : stripped,
    };
  }
  if (drop.payoutAzc && /^\d/.test(drop.payoutAzc)) {
    return { kind: "azc", label: groupDigits(drop.payoutAzc.replace(/^\+/, "")) };
  }
  const azcMatch = stripped.match(/^([\d\s]+(?:[.,]\d+)?)\s*AZC$/i);
  if (azcMatch?.[1]) {
    return {
      kind: "azc",
      label: groupDigits(azcMatch[1].replace(/\s/g, "").replace(",", ".")),
    };
  }
  const gramMatch = stripped.match(/^([\d\s]+(?:[.,]\d+)?)\s*Gram$/i);
  if (gramMatch?.[1]) {
    return {
      kind: "other",
      label: `${groupDigits(gramMatch[1].replace(/\s/g, "").replace(",", "."))} Gram`,
    };
  }
  if (/^[\d\s]+(?:[.,]\d+)?$/.test(stripped)) {
    return {
      kind: "azc",
      label: groupDigits(stripped.replace(/\s/g, "").replace(",", ".")),
    };
  }
  return { kind: "other", label: stripped };
}
