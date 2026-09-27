import { InvalidTransitionError } from "./errors.js";

export const referralTransitions = {
  attributed: ["pending_activation", "activated", "rejected", "reversed"],
  pending_activation: ["activated", "rejected", "reversed"],
  activated: ["reversed"],
  rejected: [],
  reversed: [],
} as const;

export const gameRoundTransitions = {
  created: ["bet_placed", "pending", "settled", "failed", "voided"],
  bet_placed: ["pending", "settled", "failed", "voided"],
  pending: ["settled", "failed", "voided"],
  settled: [],
  failed: [],
  voided: [],
} as const;

export const giveawayTransitions = {
  draft: ["open", "cancelled"],
  open: ["closed", "cancelled"],
  closed: ["settled"],
  settled: [],
  cancelled: [],
} as const;

export const taskCompletionTransitions = {
  started: ["completed", "rejected"],
  completed: ["rewarded", "rejected"],
  rejected: [],
  rewarded: [],
} as const;

export const purchaseTransitions = {
  created: ["paid", "failed"],
  paid: ["delivered", "refunded"],
  delivered: ["refunded"],
  failed: [],
  refunded: [],
} as const;

export const shopOrderTransitions = {
  pending: ["processing", "fulfilled", "rejected"],
  processing: ["fulfilled", "rejected"],
  fulfilled: [],
  rejected: [],
} as const;

export const gramWithdrawalTransitions = {
  pending: ["processing", "fulfilled", "rejected"],
  processing: ["fulfilled", "rejected"],
  fulfilled: [],
  rejected: [],
} as const;

export const cashItemWithdrawalTransitions = {
  pending: ["processing", "fulfilled", "rejected"],
  processing: ["fulfilled", "rejected"],
  fulfilled: [],
  rejected: [],
} as const;

export const caseOpeningTransitions = {
  created: ["settled", "failed", "voided"],
  settled: [],
  failed: [],
  voided: [],
} as const;

export function canTransition(
  allowed: readonly string[],
  to: string,
): boolean {
  return allowed.includes(to);
}

export function assertTransition(
  machine: string,
  table: Record<string, readonly string[]>,
  from: string,
  to: string,
): void {
  const allowed = table[from];
  if (!allowed || !canTransition(allowed, to)) {
    throw new InvalidTransitionError(machine, from, to);
  }
}
