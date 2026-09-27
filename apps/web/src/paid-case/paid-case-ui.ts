import { groupDigits } from "../lib/format.js";
import type { PaidCaseCatalogItem, PaidCaseCode } from "./types.js";

export type PaidCaseRarity = "legendary" | "epic" | "rare" | "common";

export const PAID_CASE_TAGLINE: Record<PaidCaseCode, string> = {
  poor: "Самый доступный. Заходит каждому.",
  medium: "Баланс цены и сильных призов.",
  blatnoy: "Топ линейки. Максимум награды.",
};

const RARITY_LABEL: Record<PaidCaseRarity, string> = {
  legendary: "Легендарный",
  epic: "Эпический",
  rare: "Редкий",
  common: "Обычный",
};

function parseAmount(raw: string): bigint {
  const unsigned = raw.trim().replace(/^[+-]/, "").split(".")[0] ?? "0";
  if (!/^\d+$/.test(unsigned)) {
    return 0n;
  }
  return BigInt(unsigned);
}

function parseChance(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 100;
}

function ruPlural(n: bigint, one: string, few: string, many: string): string {
  const mod100 = Number(n % 100n);
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}

export function paidCaseRewardRarity(
  item: PaidCaseCatalogItem,
  catalogItems: readonly PaidCaseCatalogItem[] = [item],
): PaidCaseRarity {
  const chance = parseChance(item.realChance);
  if (item.rewardType === "cash_rub") {
    if (chance <= 0.01) {
      const amount = parseAmount(item.rewardAmount);
      const top = catalogItems
        .filter((row) => row.rewardType === "cash_rub" && parseChance(row.realChance) <= 0.01)
        .reduce((max, row) => {
          const value = parseAmount(row.rewardAmount);
          return value > max ? value : max;
        }, 0n);
      return amount >= top && top > 0n ? "legendary" : "epic";
    }
    if (chance <= 1) {
      return "epic";
    }
    return "rare";
  }
  if (chance <= 8) {
    return "epic";
  }
  if (chance <= 12) {
    return chance <= 10 ? "rare" : "epic";
  }
  if (chance <= 35) {
    return "rare";
  }
  return "common";
}

export function paidCaseRarityLabel(rarity: PaidCaseRarity): string {
  return RARITY_LABEL[rarity];
}

export function formatPaidCaseCoinTitle(amount: string): string {
  const value = parseAmount(amount);
  const word = ruPlural(value, "Монета", "Монеты", "Монет");
  return `${groupDigits(value.toString())} ${word}`;
}

export function formatPaidCaseCashTitle(amount: string, rarity: PaidCaseRarity): string {
  const value = parseAmount(amount);
  const word = ruPlural(value, "Рубль", "Рубля", "Рублей");
  const grouped = groupDigits(value.toString());
  if (rarity === "legendary") {
    return `${grouped} ${word.toUpperCase()}!`;
  }
  return `${grouped} ${word}`;
}

export function paidCaseRewardTitle(
  item: PaidCaseCatalogItem,
  catalogItems: readonly PaidCaseCatalogItem[] = [item],
): string {
  const rarity = paidCaseRewardRarity(item, catalogItems);
  if (item.rewardType === "cash_rub") {
    return formatPaidCaseCashTitle(item.rewardAmount, rarity);
  }
  return formatPaidCaseCoinTitle(item.rewardAmount);
}
