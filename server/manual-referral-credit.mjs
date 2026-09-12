/**
 * Idempotent admin/manual active-referral credits.
 * Does NOT create invitee users, store.referrals rows, Kick links, or wallet grants.
 * Counted by countActiveReferrals() and Referral Battle ranking.
 */

import { utcNow } from './wallet.mjs'

export const MANUAL_REFERRAL_CREDIT_KIND = 'manual_referral_credit'

/** One-shot production credit for @alldepww / Referral Battle. */
export const ALLDEPWW_MANUAL_CREDIT = {
  telegramUserId: 8014934649,
  amount: 25,
  creditKey: 'manual-referral-credit:8014934649:alldepww-battle-2026-plus25',
  contestId: 'referral-battle-2026',
  note: 'admin_adjustment:+25_active_kick_referrals_for_alldepww',
}

export function ensureManualReferralCredits(store) {
  store.manualReferralCredits = store.manualReferralCredits || {}
  store.events = store.events || {}
  return store.manualReferralCredits
}

export function manualReferralCreditEventId(creditKey) {
  return `manual-referral-credit:${String(creditKey || '').trim()}`
}

export function getManualReferralCreditRecord(store, telegramUserId) {
  ensureManualReferralCredits(store)
  const key = String(telegramUserId ?? '').trim()
  if (!key) {
    return null
  }
  const row = store.manualReferralCredits[key]
  return row && typeof row === 'object' ? row : null
}

export function getManualReferralCreditAmount(store, telegramUserId) {
  const row = getManualReferralCreditRecord(store, telegramUserId)
  if (!row) {
    return 0
  }
  return Math.max(0, Math.floor(Number(row.amount) || 0))
}

export function getManualReferralCreditReachedAt(store, telegramUserId) {
  const row = getManualReferralCreditRecord(store, telegramUserId)
  if (!row) {
    return null
  }
  return row.creditedAt || row.createdAt || null
}

/**
 * Apply an idempotent manual active-referral credit.
 * @returns {{ success: boolean, applied: boolean, alreadyApplied?: boolean, credit?: object, message: string }}
 */
export function applyManualReferralCreditOnStore(
  store,
  {
    telegramUserId,
    amount,
    creditKey,
    note = '',
    contestId = null,
    creditedAt = null,
  } = {},
) {
  ensureManualReferralCredits(store)

  const tgId = Number(telegramUserId)
  if (!Number.isFinite(tgId) || tgId <= 0) {
    return { success: false, applied: false, message: 'invalid_telegram_user_id' }
  }

  const creditAmount = Math.floor(Number(amount) || 0)
  if (creditAmount < 1) {
    return { success: false, applied: false, message: 'invalid_amount' }
  }

  const key = String(creditKey || '').trim()
  if (!key) {
    return { success: false, applied: false, message: 'missing_credit_key' }
  }

  const user = store.users?.[String(tgId)]
  if (!user) {
    return { success: false, applied: false, message: 'user_not_found' }
  }

  const eventId = manualReferralCreditEventId(key)
  if (store.events[eventId]?.done) {
    const existing = getManualReferralCreditRecord(store, tgId)
    return {
      success: true,
      applied: false,
      alreadyApplied: true,
      credit: existing,
      message: 'already_applied',
    }
  }

  const existing = getManualReferralCreditRecord(store, tgId)
  if (existing?.creditKey && existing.creditKey !== key) {
    return {
      success: false,
      applied: false,
      message: 'different_credit_already_present',
      credit: existing,
    }
  }
  if (existing?.creditKey === key) {
    store.events[eventId] = {
      eventId,
      done: true,
      kind: MANUAL_REFERRAL_CREDIT_KIND,
      telegramUserId: tgId,
      createdAt: existing.creditedAt || utcNow(),
    }
    return {
      success: true,
      applied: false,
      alreadyApplied: true,
      credit: existing,
      message: 'already_applied',
    }
  }

  const now = creditedAt || utcNow()
  const credit = {
    kind: MANUAL_REFERRAL_CREDIT_KIND,
    telegramUserId: tgId,
    amount: creditAmount,
    creditKey: key,
    contestId: contestId || null,
    note: String(note || '').trim() || null,
    creditedAt: now,
    createdAt: now,
    source: 'admin_script',
  }

  store.manualReferralCredits[String(tgId)] = credit
  store.events[eventId] = {
    eventId,
    done: true,
    kind: MANUAL_REFERRAL_CREDIT_KIND,
    telegramUserId: tgId,
    amount: creditAmount,
    createdAt: now,
  }

  // Keep denormalized counter in sync (avoid importing users.mjs — circular).
  const baseActive = Object.values(store.referrals || {}).filter(
    (item) =>
      Number(item?.referrerUserId) === tgId &&
      (item.status === 'active' || item.status === 'rewarded'),
  ).length
  user.activeReferrals = baseActive + creditAmount

  return {
    success: true,
    applied: true,
    alreadyApplied: false,
    credit,
    message: 'applied',
    activeReferrals: user.activeReferrals,
  }
}

export function planManualReferralCredit(store, spec) {
  const tgId = Number(spec?.telegramUserId)
  const amount = Math.floor(Number(spec?.amount) || 0)
  const creditKey = String(spec?.creditKey || '').trim()
  const user = store?.users?.[String(tgId)]
  const existing = getManualReferralCreditRecord(store, tgId)
  const eventId = manualReferralCreditEventId(creditKey)
  const eventDone = Boolean(store?.events?.[eventId]?.done)

  return {
    telegramUserId: tgId,
    username: user?.username || null,
    userExists: Boolean(user),
    amount,
    creditKey,
    contestId: spec?.contestId || null,
    note: spec?.note || null,
    wouldCreatePhantomUsers: false,
    wouldTouchStoreReferrals: false,
    wouldGrantCoins: false,
    wouldCallActivateReferral: false,
    alreadyApplied: eventDone || existing?.creditKey === creditKey,
    existingCreditKey: existing?.creditKey || null,
    currentManualAmount: getManualReferralCreditAmount(store, tgId),
  }
}
