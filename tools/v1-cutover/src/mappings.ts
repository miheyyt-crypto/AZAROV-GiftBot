import {
  GRAM_MINOR_PER_UNIT,
  GRAM_MINOR_SCALE,
  WELVURA_ACCOUNT_LINK_REWARD_AZC,
  WELVURA_DEPOSIT_STAGES,
} from "@giftbot/domain";

export const V1_FREE_CASE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const V1_REFERRAL_CASE_EVERY = 5;
export const V1_ACCOUNT_LINK_REWARD = 1000n;
export const V1_XP_CURVE_BASE = 700;
export const V1_XP_CURVE_PER_LEVEL = 33;
export const V1_LEVEL_REWARD_PER_LEVEL = 50n;
export const MAX_STREAM_STREAK = 10;

/** Proven V1 deposit ladder (partners.mjs DEPOSIT_LADDER). */
export const V1_WELVURA_DEPOSIT_LADDER: readonly {
  stageNumber: number;
  requiredDepositRub: bigint;
  rewardAzc: bigint;
}[] = [
  { stageNumber: 1, requiredDepositRub: 100n, rewardAzc: 2_000n },
  { stageNumber: 2, requiredDepositRub: 1_000n, rewardAzc: 3_000n },
  { stageNumber: 3, requiredDepositRub: 2_500n, rewardAzc: 5_000n },
  { stageNumber: 4, requiredDepositRub: 5_000n, rewardAzc: 10_000n },
  { stageNumber: 5, requiredDepositRub: 10_000n, rewardAzc: 20_000n },
  { stageNumber: 6, requiredDepositRub: 20_000n, rewardAzc: 40_000n },
  { stageNumber: 7, requiredDepositRub: 35_000n, rewardAzc: 70_000n },
  { stageNumber: 8, requiredDepositRub: 50_000n, rewardAzc: 100_000n },
  { stageNumber: 9, requiredDepositRub: 100_000n, rewardAzc: 200_000n },
  { stageNumber: 10, requiredDepositRub: 250_000n, rewardAzc: 500_000n },
  { stageNumber: 11, requiredDepositRub: 500_000n, rewardAzc: 1_000_000n },
  { stageNumber: 12, requiredDepositRub: 750_000n, rewardAzc: 1_500_000n },
  { stageNumber: 13, requiredDepositRub: 1_000_000n, rewardAzc: 2_000_000n },
];

export const CORE_TASK_MAP = {
  "telegram-subscribe": "telegram_subscribe_azarov222",
  "launch-bot": "telegram_bot_started",
  "kick-connect": "kick_link",
  "kick-follow": "kick_follow_azarov7777",
  "kick-nickname": "kick_nickname_tag",
  "referral-invite": "referral_3_active",
} as const;

export type V1CoreTaskId = keyof typeof CORE_TASK_MAP;

export const LIVE_SHOP_PRODUCT_MAP: Record<
  string,
  { v2Code: string; catalog: "live" | "disabled" | "legacy_inactive" }
> = {
  "stream-donate": { v2Code: "donat", catalog: "live" },
  "welvura-balance-200": { v2Code: "welvura-200", catalog: "live" },
  "welvura-balance-500": { v2Code: "welvura-500", catalog: "live" },
  "cash-5000": { v2Code: "welvura-5000", catalog: "live" },
  "stream-music": { v2Code: "music", catalog: "live" },
  "streak-freeze": { v2Code: "streak-freeze", catalog: "live" },
  "kick-vip-forever": { v2Code: "vip-kick", catalog: "live" },
  "tg-premium-6m": { v2Code: "premium-6", catalog: "disabled" },
  "tg-premium-12m": { v2Code: "premium-12", catalog: "disabled" },
  "diamond-autograph": {
    v2Code: "legacy-diamond-autograph",
    catalog: "legacy_inactive",
  },
};

export const PURCHASE_STATUS_MAP: Record<
  string,
  "paid" | "delivered" | "failed"
> = {
  pending: "paid",
  processing: "paid",
  completed: "delivered",
  rejected: "failed",
  cancelled: "failed",
};

/** V1 display drop table (src/data/case-drops.json). Not V2 runtime weights. */
export const V1_CASE_DISPLAY_DROPS: Record<
  string,
  readonly { id: string; name: string; amount: number; currency: string; chance: number }[]
> = {
  poor: [
    { id: "poor-rub-5000", name: "5000 РУБЛЕЙ!", amount: 5000, currency: "RUB", chance: 1 },
    { id: "poor-rub-1000", name: "1000 Рублей", amount: 1000, currency: "RUB", chance: 5 },
    { id: "poor-coins-12000", name: "12 000 Монет", amount: 12000, currency: "COINS", chance: 7 },
    { id: "poor-coins-7777", name: "7777 Монет", amount: 7777, currency: "COINS", chance: 10 },
    { id: "poor-coins-5000", name: "5000 Монет", amount: 5000, currency: "COINS", chance: 20 },
    { id: "poor-coins-3333", name: "3333 Монеты", amount: 3333, currency: "COINS", chance: 57 },
  ],
  medium: [
    { id: "medium-rub-10000", name: "10 000 РУБЛЕЙ", amount: 10000, currency: "RUB", chance: 2 },
    { id: "medium-rub-5000", name: "5000 РУБЛЕЙ!", amount: 5000, currency: "RUB", chance: 2 },
    { id: "medium-rub-1000", name: "1000 Рублей", amount: 1000, currency: "RUB", chance: 10 },
    { id: "medium-coins-20000", name: "20 000 Монет", amount: 20000, currency: "COINS", chance: 11 },
    { id: "medium-coins-11111", name: "11111 Монет", amount: 11111, currency: "COINS", chance: 28 },
    { id: "medium-coins-8888", name: "8888 Монет", amount: 8888, currency: "COINS", chance: 47 },
  ],
  rich: [
    { id: "rich-rub-30000", name: "30 000 РУБЛЕЙ!", amount: 30000, currency: "RUB", chance: 1 },
    { id: "rich-rub-10000", name: "10 000 РУБЛЕЙ", amount: 10000, currency: "RUB", chance: 2 },
    { id: "rich-rub-5000", name: "5000 Рублей!", amount: 5000, currency: "RUB", chance: 5 },
    { id: "rich-rub-2000", name: "2000 Рублей", amount: 2000, currency: "RUB", chance: 10 },
    { id: "rich-coins-44444", name: "44 444 Монет", amount: 44444, currency: "COINS", chance: 35 },
    { id: "rich-coins-22222", name: "22 222 Монет", amount: 22222, currency: "COINS", chance: 47 },
  ],
  referral: [
    { id: "referral-rub-3000", name: "3000 РУБЛЕЙ!", amount: 3000, currency: "RUB", chance: 1 },
    { id: "referral-rub-1000", name: "1000 РУБЛЕЙ", amount: 1000, currency: "RUB", chance: 2 },
    { id: "referral-coins-15000", name: "15 000 Монет", amount: 15000, currency: "COINS", chance: 8 },
    { id: "referral-coins-6000", name: "6000 Монет", amount: 6000, currency: "COINS", chance: 20 },
    { id: "referral-coins-2500", name: "2500 Монет", amount: 2500, currency: "COINS", chance: 30 },
    { id: "referral-coins-1000", name: "1000 Монет", amount: 1000, currency: "COINS", chance: 39 },
  ],
};

export function mapPaidCaseCode(v1CaseId: string): string | undefined {
  if (v1CaseId === "poor" || v1CaseId === "medium") {
    return v1CaseId;
  }
  if (v1CaseId === "rich") {
    return "blatnoy";
  }
  return undefined;
}

export function lookupV1CaseDrop(caseId: string, rewardId: string) {
  const table = V1_CASE_DISPLAY_DROPS[caseId];
  return table?.find((row) => row.id === rewardId);
}

export function assertWelvuraLaddersMatch(): string | undefined {
  if (WELVURA_ACCOUNT_LINK_REWARD_AZC !== V1_ACCOUNT_LINK_REWARD) {
    return `Welvura account-link reward differs: V1 ${String(V1_ACCOUNT_LINK_REWARD)} V2 ${String(WELVURA_ACCOUNT_LINK_REWARD_AZC)}`;
  }
  if (WELVURA_DEPOSIT_STAGES.length !== V1_WELVURA_DEPOSIT_LADDER.length) {
    return "Welvura deposit stage count differs";
  }
  for (const v1 of V1_WELVURA_DEPOSIT_LADDER) {
    const v2 = WELVURA_DEPOSIT_STAGES.find((s) => s.stageNumber === v1.stageNumber);
    if (
      !v2 ||
      v2.requiredDepositRub !== v1.requiredDepositRub ||
      v2.rewardAzc !== v1.rewardAzc
    ) {
      return `Welvura stage ${String(v1.stageNumber)} amount/reward differs from V1`;
    }
  }
  return undefined;
}

export function v1LevelRewardAzc(level: number): bigint {
  return BigInt(level) * V1_LEVEL_REWARD_PER_LEVEL;
}

export function computeV1Xp(chatMessages: number, watchSeconds: number): bigint {
  const messages = Math.max(0, Math.floor(chatMessages));
  const seconds = Math.max(0, Math.floor(watchSeconds));
  return BigInt(messages + Math.floor(seconds / 60));
}

/**
 * Proven V1 countActiveReferrals (users.mjs):
 * rewarded/active referral rows for referrer + stacked manualReferralCredits.amount.
 * Manual credits do not create invitee users or store.referrals rows.
 */
export function listManualReferralCreditsForUser(
  credits: Record<string, Record<string, unknown>>,
  telegramUserId: string,
): Record<string, unknown>[] {
  const tg = telegramUserId.trim();
  if (!tg) {
    return [];
  }
  const byKey = new Map<string, Record<string, unknown>>();
  for (const [mapKey, row] of Object.entries(credits)) {
    const rowTg = String(row.telegramUserId ?? "");
    const matchesUser = rowTg === tg || mapKey === tg;
    if (!matchesUser) {
      continue;
    }
    const creditKey = typeof row.creditKey === "string" ? row.creditKey.trim() : "";
    if (row.stackedAmounts && creditKey && credits[creditKey]) {
      continue;
    }
    const dedupeKey = creditKey || mapKey;
    if (!byKey.has(dedupeKey)) {
      byKey.set(dedupeKey, row);
    }
  }
  return [...byKey.values()];
}

export function getManualReferralCreditAmount(
  credits: Record<string, Record<string, unknown>>,
  telegramUserId: string,
): number {
  let sum = 0;
  for (const row of listManualReferralCreditsForUser(credits, telegramUserId)) {
    const amount = Number(row.amount);
    if (Number.isFinite(amount) && amount > 0) {
      sum += Math.floor(amount);
    }
  }
  return sum;
}

export function canonicalActivatedReferralCount(
  rewardedOrActiveRows: number,
  manualCredits: number,
): number {
  return Math.max(0, rewardedOrActiveRows) + Math.max(0, manualCredits);
}

export function referralCaseAvailability(activatedCount: number, opened: number): {
  earned: number;
  consumed: number;
  available: number;
} {
  const earned = Math.floor(Math.max(0, activatedCount) / V1_REFERRAL_CASE_EVERY);
  const openedN = Math.max(0, opened);
  return {
    earned,
    consumed: Math.min(openedN, earned),
    available: Math.max(0, earned - openedN),
  };
}

export function dragonmoneyTaskStage(taskId: string): {
  kind: "account_link" | "deposit";
  stageNumber?: number;
} | undefined {
  const match = /^dragonmoney-task-(\d+)$/.exec(taskId);
  if (!match) {
    return undefined;
  }
  const n = Number(match[1]);
  if (n === 1) {
    return { kind: "account_link" };
  }
  if (n >= 2 && n <= 14) {
    return { kind: "deposit", stageNumber: n - 1 };
  }
  return undefined;
}

export { GRAM_MINOR_PER_UNIT, GRAM_MINOR_SCALE };
