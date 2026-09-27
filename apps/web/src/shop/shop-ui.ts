import { groupDigits } from "../lib/format.js";
import type { PaidCaseCatalogItem } from "../paid-case/types.js";
import type { ShopRequiredField } from "./shop-messages.js";

export function canAffordAzc(balanceAzc: string, priceAzc: string): boolean {
  return parseAzcInt(balanceAzc) >= parseAzcInt(priceAzc);
}

export function azcDeficit(balanceAzc: string, priceAzc: string): bigint {
  const missing = parseAzcInt(priceAzc) - parseAzcInt(balanceAzc);
  return missing > 0n ? missing : 0n;
}

function parseAzcInt(raw: string): bigint {
  const unsigned = raw.trim().replace(/^[+-]/, "");
  const whole = unsigned.split(".")[0] ?? "0";
  if (!/^\d+$/.test(whole)) {
    return 0n;
  }
  return BigInt(whole);
}

export function caseCashBadge(items: PaidCaseCatalogItem[]): string | null {
  let max: bigint | null = null;
  for (const item of items) {
    if (item.rewardType !== "cash_rub") {
      continue;
    }
    const amount = parseAzcInt(item.rewardAmount);
    if (max === null || amount > max) {
      max = amount;
    }
  }
  if (max === null) {
    return null;
  }
  return `до ${groupDigits(String(max))} ₽`;
}

export function remainingInviteCopy(current: number, target: number): {
  remaining: number;
  label: string;
} {
  const remaining = Math.max(0, target - current);
  if (remaining === 0) {
    return { remaining, label: "Нет доступных кейсов" };
  }
  const word =
    remaining % 10 === 1 && remaining % 100 !== 11
      ? "друга"
      : remaining % 10 >= 2 && remaining % 10 <= 4 && (remaining % 100 < 12 || remaining % 100 > 14)
        ? "друга"
        : "друзей";
  return { remaining, label: `Осталось пригласить ${remaining} ${word}` };
}

export function caseTitle(title: string): string {
  return /кейс/i.test(title) ? title : `${title} кейс`;
}

export const SHOP_SHEET_FIELD_LABEL: Record<ShopRequiredField, string> = {
  welvuraId: "Welvura ID",
  slotName: "Название слота",
  displayNickname: "Ник для доната",
  donationText: "Текст доната",
  mediaUrl: "Твоя ссылка на трек",
  telegramUsername: "Telegram username",
  kickUsername: "Kick username",
};

export function shopFieldMax(field: ShopRequiredField): number | undefined {
  if (field === "displayNickname") {
    return 20;
  }
  if (field === "donationText") {
    return 300;
  }
  if (field === "slotName") {
    return 80;
  }
  return undefined;
}

export function shopFieldPlaceholder(
  field: ShopRequiredField,
  productCode?: string,
): string | undefined {
  if (field === "welvuraId") {
    return "Введите Welvura ID";
  }
  if (field === "slotName") {
    return productCode === "welvura-bonus-3000"
      ? "Например: Sweet Bonanza"
      : "Например: Gates of Olympus";
  }
  if (field === "mediaUrl") {
    return "https://";
  }
  return undefined;
}
