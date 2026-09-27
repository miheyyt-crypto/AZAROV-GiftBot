export const TX_REFUND = "refund";
export const TX_MINES_WIN = "mines_win";
export const TX_TOWER_WIN = "tower_win";

const REFUND_DESCRIPTION = "cutover administrative refund / unresolved game refund";

type StoreMaps = {
  events?: Record<string, unknown>;
  coinTransactions?: Record<string, unknown>;
  txIndexByUser?: Record<string, string[]>;
};

function ensureLedger(store: StoreMaps): void {
  store.events = store.events ?? {};
  store.coinTransactions = store.coinTransactions ?? {};
  store.txIndexByUser = store.txIndexByUser ?? {};
}

function alreadyProcessed(store: StoreMaps, eventId: string, uniqueKey: string): boolean {
  if (store.events?.[eventId] || store.coinTransactions?.[eventId]) {
    return true;
  }
  if (uniqueKey && (store.events?.[uniqueKey] || store.coinTransactions?.[uniqueKey])) {
    return true;
  }
  return false;
}

export function creditUser(
  store: StoreMaps & { users?: Record<string, Record<string, unknown>> },
  user: Record<string, unknown>,
  amount: number,
  type: string,
  eventId: string,
  meta: { referenceId?: string; description?: string },
): { applied: boolean; reason: string } {
  ensureLedger(store);
  const credit = Math.floor(amount);
  if (!Number.isInteger(credit) || credit < 1) {
    return { applied: false, reason: "invalid_amount" };
  }
  const telegramId = user.telegramId ?? user.id;
  const referenceId = meta.referenceId ? String(meta.referenceId) : "";
  const uniqueKey = referenceId ? `${type}:${referenceId}:${String(telegramId)}` : "";
  if (alreadyProcessed(store, eventId, uniqueKey)) {
    return { applied: false, reason: "already_granted" };
  }
  const before = Number(user.balance || 0);
  const after = before + credit;
  user.balance = after;
  const createdAt = new Date().toISOString();
  const transaction = {
    id: eventId,
    userId: telegramId,
    amount: credit,
    type,
    referenceId: referenceId || null,
    description: (meta.description ?? REFUND_DESCRIPTION).slice(0, 240),
    balanceAfter: after,
    createdAt,
  };
  store.events![eventId] = { eventId, ...transaction };
  store.coinTransactions![eventId] = transaction;
  const key = String(telegramId);
  const prev = Array.isArray(store.txIndexByUser![key]) ? store.txIndexByUser![key] : [];
  store.txIndexByUser![key] = [...prev, eventId];
  if (uniqueKey) {
    store.events![uniqueKey] = store.events![eventId];
    store.coinTransactions![uniqueKey] = transaction;
  }
  const prior = Array.isArray(user.earnedRewards) ? user.earnedRewards.map(String) : [];
  user.earnedRewards = [...new Set([...prior, eventId])];
  return { applied: true, reason: "granted" };
}

export { REFUND_DESCRIPTION };
