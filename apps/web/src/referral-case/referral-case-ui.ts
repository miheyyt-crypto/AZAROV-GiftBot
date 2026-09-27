import {
  formatPaidCaseCashTitle,
  formatPaidCaseCoinTitle,
  paidCaseRarityLabel,
  type PaidCaseRarity,
} from "../paid-case/paid-case-ui.js";
import type { ReferralCaseCatalogItem } from "./types.js";

export const REFERRAL_CASE_TAGLINE = "За активных друзей. Без оплаты монетами.";

type RewardRef = Pick<ReferralCaseCatalogItem, "rewardType" | "rewardAmount">;

function parseAmount(raw: string): bigint {
  const unsigned = raw.trim().replace(/^[+-]/, "").split(".")[0] ?? "0";
  if (!/^\d+$/.test(unsigned)) {
    return 0n;
  }
  return BigInt(unsigned);
}

export function referralRewardRarity(
  item: RewardRef,
  catalogItems: readonly RewardRef[] = [item],
): PaidCaseRarity {
  const amount = parseAmount(item.rewardAmount);
  if (item.rewardType === "cash_rub") {
    const top = catalogItems
      .filter((row) => row.rewardType === "cash_rub")
      .reduce((max, row) => {
        const value = parseAmount(row.rewardAmount);
        return value > max ? value : max;
      }, 0n);
    return amount >= top && top > 0n ? "legendary" : "epic";
  }
  const ranked = catalogItems
    .filter((row) => row.rewardType === "azc")
    .map((row) => parseAmount(row.rewardAmount))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const first = ranked[0] ?? amount;
  const second = ranked[1] ?? 0n;
  if (amount >= first) {
    return "epic";
  }
  if (second > 0n && amount >= second) {
    return "rare";
  }
  return "common";
}

export function referralRewardTitle(
  item: RewardRef,
  catalogItems: readonly RewardRef[] = [item],
): string {
  const rarity = referralRewardRarity(item, catalogItems);
  if (item.rewardType === "cash_rub") {
    return formatPaidCaseCashTitle(item.rewardAmount, rarity);
  }
  return formatPaidCaseCoinTitle(item.rewardAmount);
}

export function referralRarityLabel(rarity: PaidCaseRarity): string {
  return paidCaseRarityLabel(rarity);
}
