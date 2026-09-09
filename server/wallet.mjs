/** Canonical ledger types (server-authoritative). */
export const TX_TYPE = {
  TASK_REWARD: 'task_reward',
  REFERRAL_REWARD: 'referral_reward',
  PARTNER_REWARD: 'partner_reward',
  CASE_REWARD: 'case_reward',
  CASE_PURCHASE: 'case_purchase',
  SHOP_PURCHASE: 'shop_purchase',
  STREAK_FREEZE: 'streak_freeze',
  ACHIEVEMENT_REWARD: 'achievement_reward',
  GIVEAWAY_REWARD: 'giveaway_reward',
  ADMIN_ADJUSTMENT: 'admin_adjustment',
  REFUND: 'refund',
}

const LEGACY_TYPE_MAP = {
  TASK_REWARD: TX_TYPE.TASK_REWARD,
  REFERRAL_REWARD: TX_TYPE.REFERRAL_REWARD,
  PARTNER_TASK_REWARD: TX_TYPE.PARTNER_REWARD,
  PARTNER_REWARD: TX_TYPE.PARTNER_REWARD,
  CASE_PRIZE: TX_TYPE.CASE_REWARD,
  CASE_REWARD: TX_TYPE.CASE_REWARD,
  CASE_PURCHASE: TX_TYPE.CASE_PURCHASE,
  SHOP_PURCHASE: TX_TYPE.SHOP_PURCHASE,
  STREAK_FREEZE: TX_TYPE.STREAK_FREEZE,
  ACHIEVEMENT_REWARD: TX_TYPE.ACHIEVEMENT_REWARD,
  GIVEAWAY_REWARD: TX_TYPE.GIVEAWAY_REWARD,
  REFERRAL_CASE: TX_TYPE.CASE_REWARD,
  DEV_TEST_GRANT: TX_TYPE.ADMIN_ADJUSTMENT,
  ADMIN_ADJUSTMENT: TX_TYPE.ADMIN_ADJUSTMENT,
  REFUND: TX_TYPE.REFUND,
}

const ALLOWED_TYPES = new Set(Object.values(TX_TYPE))

export function utcNow() {
  return new Date().toISOString()
}

export function normalizeTxType(type) {
  const raw = String(type || '')
  if (ALLOWED_TYPES.has(raw)) {
    return raw
  }
  return LEGACY_TYPE_MAP[raw] || raw.toLowerCase() || 'admin_adjustment'
}

function normalizeIntegerAmount(amount) {
  const value = Number(amount)
  if (!Number.isInteger(value) || value === 0) {
    throw new Error('invalid_coin_amount')
  }
  return value
}

function normalizePositiveAmount(amount) {
  const value = normalizeIntegerAmount(amount)
  if (value <= 0) {
    throw new Error('invalid_coin_amount')
  }
  return value
}

function ensureLedger(store) {
  store.events = store.events || {}
  store.coinTransactions = store.coinTransactions || {}
}

function getUserBalance(user) {
  const balance = Number(user.balance || 0)
  return Number.isFinite(balance) ? balance : 0
}

/**
 * Unique transactions for a user (dedupe alias keys that point at the same id).
 */
export function listUserTransactions(store, userId) {
  ensureLedger(store)
  const seen = new Set()
  return Object.values(store.coinTransactions)
    .filter((item) => Number(item.userId) === Number(userId))
    .filter((item) => {
      const id = item.id
      if (!id || seen.has(id)) {
        return false
      }
      seen.add(id)
      return true
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export function sumUserLedger(store, userId) {
  return listUserTransactions(store, userId).reduce((sum, item) => sum + Number(item.amount || 0), 0)
}

export function hasEvent(store, eventId) {
  ensureLedger(store)
  return Boolean(store.events[eventId] || store.coinTransactions[eventId])
}

function alreadyProcessed(store, eventId, uniqueKey) {
  if (store.events[eventId] || store.coinTransactions[eventId]) {
    return true
  }
  if (uniqueKey && (store.events[uniqueKey] || store.coinTransactions[uniqueKey])) {
    return true
  }
  return false
}

/**
 * Apply a signed amount to the user balance and append an idempotent ledger row.
 * amount > 0 credit, amount < 0 debit. balanceAfter is always stored.
 */
export function applyBalanceChange(store, user, amount, type, eventId, meta = {}) {
  ensureLedger(store)
  const delta = normalizeIntegerAmount(amount)
  const txType = normalizeTxType(type)
  if (!ALLOWED_TYPES.has(txType)) {
    throw new Error('invalid_tx_type')
  }

  const referenceId = meta.referenceId ? String(meta.referenceId) : ''
  const uniqueKey = referenceId ? `${txType}:${referenceId}:${user.telegramId}` : ''

  if (alreadyProcessed(store, eventId, uniqueKey)) {
    return {
      applied: false,
      reason: 'already_granted',
      user,
      transaction: store.coinTransactions[eventId] || store.coinTransactions[uniqueKey] || null,
    }
  }

  const before = getUserBalance(user)
  const after = before + delta
  if (after < 0) {
    return {
      applied: false,
      reason: 'insufficient',
      user,
      transaction: null,
    }
  }

  user.balance = after

  const createdAt = utcNow()
  const transaction = {
    id: eventId,
    userId: user.telegramId,
    amount: delta,
    type: txType,
    referenceId: referenceId || null,
    description: meta.description ? String(meta.description).slice(0, 240) : null,
    balanceAfter: after,
    createdAt,
  }

  store.events[eventId] = { eventId, ...transaction }
  store.coinTransactions[eventId] = transaction

  if (uniqueKey) {
    store.events[uniqueKey] = store.events[eventId]
    store.coinTransactions[uniqueKey] = transaction
  }

  if (delta > 0) {
    const prior = Array.isArray(user.earnedRewards) ? user.earnedRewards : []
    user.earnedRewards = [...new Set([...prior, eventId])]
  }

  return {
    applied: true,
    reason: 'applied',
    user,
    transaction,
  }
}

export function addCoins(store, user, amount, reason, eventId, meta = {}) {
  const credit = normalizePositiveAmount(amount)
  const result = applyBalanceChange(store, user, credit, reason, eventId, meta)
  return {
    granted: result.applied,
    reason: result.applied ? 'granted' : result.reason,
    user: result.user,
    transaction: result.transaction,
  }
}

export function spendCoins(store, user, amount, reason, eventId, meta = {}) {
  const debit = normalizePositiveAmount(amount)
  const result = applyBalanceChange(store, user, -debit, reason, eventId, meta)
  return {
    spent: result.applied,
    reason: result.applied ? 'spent' : result.reason,
    user: result.user,
    transaction: result.transaction,
  }
}

/**
 * Idempotent ledger row with amount 0 (inventory / non-balance events).
 * Does not change user.balance.
 */
export function recordLedgerNote(store, user, type, eventId, meta = {}) {
  ensureLedger(store)
  const txType = normalizeTxType(type)
  if (!ALLOWED_TYPES.has(txType)) {
    throw new Error('invalid_tx_type')
  }

  const referenceId = meta.referenceId ? String(meta.referenceId) : ''
  const uniqueKey = referenceId ? `${txType}:${referenceId}:${user.telegramId}` : ''

  if (alreadyProcessed(store, eventId, uniqueKey)) {
    return {
      applied: false,
      reason: 'already_granted',
      user,
      transaction: store.coinTransactions[eventId] || store.coinTransactions[uniqueKey] || null,
    }
  }

  const createdAt = utcNow()
  const balanceAfter = getUserBalance(user)
  const transaction = {
    id: eventId,
    userId: user.telegramId,
    amount: 0,
    type: txType,
    referenceId: referenceId || null,
    description: meta.description ? String(meta.description).slice(0, 240) : null,
    balanceAfter,
    createdAt,
  }

  store.events[eventId] = { eventId, ...transaction }
  store.coinTransactions[eventId] = transaction

  if (uniqueKey) {
    store.events[uniqueKey] = store.events[eventId]
    store.coinTransactions[uniqueKey] = transaction
  }

  return {
    applied: true,
    reason: 'applied',
    user,
    transaction,
  }
}

export function sumTransactions(store, userId, type) {
  const normalized = normalizeTxType(type)
  return listUserTransactions(store, userId)
    .filter((item) => normalizeTxType(item.type) === normalized && item.amount > 0)
    .reduce((sum, item) => sum + item.amount, 0)
}

/** Soft consistency check used by tests / diagnostics. */
export function balanceMatchesLedger(store, user) {
  const ledger = sumUserLedger(store, user.telegramId)
  return getUserBalance(user) === ledger
}
