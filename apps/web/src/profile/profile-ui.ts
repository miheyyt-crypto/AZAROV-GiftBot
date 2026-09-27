import { ledgerDeltaKind } from "../lib/format.js";
import type { ProfileLedgerEntry } from "./types.js";

export type OperationTab = "all" | "in" | "purchase" | "reward";

const PURCHASE_TYPES = new Set([
  "purchase",
  "shop_purchase",
  "paid_case_purchase",
]);

const REWARD_TYPES = new Set([
  "prize",
  "referral_reward",
  "referral_inviter_reward",
  "referral_referred_reward",
  "referral_case_reward",
  "task_reward",
  "welvura_deposit_reward",
  "level_reward",
  "stream_streak_reward",
  "giveaway_reward",
  "reward",
  "promo_code_reward",
  "free_case_reward",
  "paid_case_reward",
  "achievement_reward",
  "mines_win",
  "dice_win",
  "rolls_win",
  "deposit",
]);

export function notificationAccent(type: string): "gold" | "red" | "green" | "violet" {
  const key = type.toLowerCase();
  if (key.includes("reject") || key.includes("declin") || key.includes("fail")) {
    return "red";
  }
  if (
    key.includes("fulfill") ||
    key.includes("complete") ||
    key.includes("win") ||
    key.includes("welcome") ||
    key.includes("deposit")
  ) {
    return "green";
  }
  if (
    key.includes("level") ||
    key.includes("achievement") ||
    key.includes("promo") ||
    key.includes("reward")
  ) {
    return "gold";
  }
  return "violet";
}

export function cashFilterMatch(
  status: "pending" | "processing" | "fulfilled" | "rejected",
  filter: "all" | "pending" | "processing" | "fulfilled" | "rejected",
): boolean {
  return filter === "all" || status === filter;
}

export function operationTabMatch(row: ProfileLedgerEntry, tab: OperationTab): boolean {
  if (tab === "all") {
    return true;
  }
  if (tab === "in") {
    return ledgerDeltaKind(row.delta) === "in";
  }
  if (tab === "purchase") {
    return PURCHASE_TYPES.has(row.type);
  }
  return REWARD_TYPES.has(row.type);
}

export function operationTone(type: string): "purchase" | "reward" | "bet" | "other" {
  if (PURCHASE_TYPES.has(type)) {
    return "purchase";
  }
  if (REWARD_TYPES.has(type)) {
    return "reward";
  }
  if (type.includes("bet")) {
    return "bet";
  }
  return "other";
}
