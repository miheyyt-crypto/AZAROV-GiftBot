import { InvalidAmountError } from "./errors.js";

export function asBigInt(value: bigint | string | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

export const DEBIT_TYPES = new Set([
  "purchase",
  "bet",
  "shop_purchase",
  "paid_case_purchase",
  "mines_bet",
  "dice_bet",
  "rolls_bet",
  "stream_donation",
]);
export const CREDIT_TYPES = new Set([
  "deposit",
  "reward",
  "referral_reward",
  "prize",
  "refund",
  "promo_code_reward",
  "shop_refund",
  "free_case_reward",
  "paid_case_reward",
  "referral_inviter_reward",
  "referral_referred_reward",
  "referral_manual_credit",
  "referral_case_reward",
  "task_reward",
  "welvura_deposit_reward",
  "level_reward",
  "stream_streak_reward",
  "mines_win",
  "dice_win",
  "rolls_win",
  "giveaway_reward",
  "achievement_reward",
  "referral_contest_reward",
]);

export function assertAmountForType(type: string, amountMinor: bigint): void {
  if (amountMinor === 0n) {
    throw new InvalidAmountError("amount must be non-zero");
  }
  if (DEBIT_TYPES.has(type) && amountMinor > 0n) {
    throw new InvalidAmountError(`${type} must be a negative amount`);
  }
  if (CREDIT_TYPES.has(type) && amountMinor < 0n) {
    throw new InvalidAmountError(`${type} must be a positive amount`);
  }
}
