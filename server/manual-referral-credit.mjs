/**
 * Idempotent admin/manual active-referral credits (+ optional coin grant).
 * Does NOT create invitee users, store.referrals rows, or Kick links.
 * Does NOT call activateReferralOnStore.
 * Counted by countActiveReferrals() and Referral Battle ranking.
 * Friends «Заработано» uses user.referralEarnings (via toPublicUser).
 */

import { addCoins, TX_TYPE, utcNow } from './wallet.mjs'

export const MANUAL_REFERRAL_CREDIT_KIND = 'manual_referral_credit'

/** One-shot production credit for @alldepww / Referral Battle. */
export const ALLDEPWW_MANUAL_CREDIT = {
  telegramUserId: 8014934649,
  amount: 25,
  coinAmount: 25000,
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

export function manualReferralCreditCoinEventId(creditKey) {
  return `manual-referral-credit-coins:${String(creditKey || '').trim()}`
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

function syncActiveReferralsField(store, user, tgId, creditAmount) {
  const baseActive = Object.values(store.referrals || {}).filter(
    (item) =>
      Number(item?.referrerUserId) === tgId &&
      (item.status === 'active' || item.status === 'rewarded'),
  ).length
  user.activeReferrals = baseActive + creditAmount
}

function isCreditFullyApplied(store, credit, creditKey, coinAmount) {
  if (!credit || credit.creditKey !== creditKey) {
    return false
  }
  const eventId = manualReferralCreditEventId(creditKey)
  const coinEventId = manualReferralCreditCoinEventId(creditKey)
  const referralDone = Boolean(store.events[eventId]?.done)
  if (!referralDone) {
    return false
  }
  if (coinAmount < 1) {
    return true
  }
  return Boolean(credit.coinsGranted && credit.referralEarningsGranted && store.events[coinEventId])
}

/**
 * Apply an idempotent manual active-referral credit (+ optional ADMIN_ADJUSTMENT coins).
 * @returns {{ success: boolean, applied: boolean, alreadyApplied?: boolean, credit?: object, message: string }}
 */
export function applyManualReferralCreditOnStore(
  store,
  {
    telegramUserId,
    amount,
    coinAmount = 0,
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

  const coins = Math.max(0, Math.floor(Number(coinAmount) || 0))

  const key = String(creditKey || '').trim()
  if (!key) {
    return { success: false, applied: false, message: 'missing_credit_key' }
  }

  const user = store.users?.[String(tgId)]
  if (!user) {
    return { success: false, applied: false, message: 'user_not_found' }
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

  if (isCreditFullyApplied(store, existing, key, coins)) {
    return {
      success: true,
      applied: false,
      alreadyApplied: true,
      credit: existing,
      message: 'already_applied',
    }
  }

  const now = creditedAt || existing?.creditedAt || utcNow()
  const eventId = manualReferralCreditEventId(key)
  const coinEventId = manualReferralCreditCoinEventId(key)
  let appliedSomething = false

  let credit = existing?.creditKey === key
    ? { ...existing }
    : {
        kind: MANUAL_REFERRAL_CREDIT_KIND,
        telegramUserId: tgId,
        amount: creditAmount,
        coinAmount: coins,
        creditKey: key,
        contestId: contestId || null,
        note: String(note || '').trim() || null,
        creditedAt: now,
        createdAt: now,
        source: 'admin_script',
        coinsGranted: false,
        coinEventId: coins > 0 ? coinEventId : null,
        referralEarningsGranted: false,
      }

  if (!store.events[eventId]?.done || existing?.creditKey !== key) {
    credit = {
      ...credit,
      kind: MANUAL_REFERRAL_CREDIT_KIND,
      telegramUserId: tgId,
      amount: creditAmount,
      coinAmount: coins,
      creditKey: key,
      contestId: contestId || credit.contestId || null,
      note: String(note || credit.note || '').trim() || null,
      creditedAt: credit.creditedAt || now,
      createdAt: credit.createdAt || now,
      source: credit.source || 'admin_script',
      coinsGranted: Boolean(credit.coinsGranted),
      coinEventId: coins > 0 ? coinEventId : credit.coinEventId || null,
      referralEarningsGranted: Boolean(credit.referralEarningsGranted),
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
    syncActiveReferralsField(store, user, tgId, creditAmount)
    appliedSomething = true
  } else {
    syncActiveReferralsField(store, user, tgId, creditAmount)
  }

  if (coins > 0 && !credit.coinsGranted) {
    const grant = addCoins(store, user, coins, TX_TYPE.ADMIN_ADJUSTMENT, coinEventId, {
      referenceId: key,
      description: note || 'manual_referral_credit_admin_adjustment',
      manualReferralCreditKey: key,
      contestId: contestId || null,
    })
    if (!grant.granted && grant.reason !== 'already_granted') {
      return {
        success: false,
        applied: appliedSomething,
        message: `coin_grant_failed:${grant.reason || 'unknown'}`,
        credit,
      }
    }
    credit.coinsGranted = true
    credit.coinEventId = coinEventId
    credit.coinAmount = coins
    if (grant.granted) {
      appliedSomething = true
    }
  }

  if (coins > 0 && !credit.referralEarningsGranted) {
    user.referralEarnings = Math.max(0, Math.floor(Number(user.referralEarnings) || 0)) + coins
    credit.referralEarningsGranted = true
    appliedSomething = true
  }

  store.manualReferralCredits[String(tgId)] = credit

  if (!appliedSomething) {
    return {
      success: true,
      applied: false,
      alreadyApplied: true,
      credit,
      message: 'already_applied',
    }
  }

  return {
    success: true,
    applied: true,
    alreadyApplied: false,
    credit,
    message: 'applied',
    activeReferrals: user.activeReferrals,
    balance: user.balance,
    referralEarnings: user.referralEarnings,
  }
}

export function planManualReferralCredit(store, spec) {
  const tgId = Number(spec?.telegramUserId)
  const amount = Math.floor(Number(spec?.amount) || 0)
  const coinAmount = Math.max(0, Math.floor(Number(spec?.coinAmount) || 0))
  const creditKey = String(spec?.creditKey || '').trim()
  const user = store?.users?.[String(tgId)]
  const existing = getManualReferralCreditRecord(store, tgId)
  const eventId = manualReferralCreditEventId(creditKey)
  const coinEventId = manualReferralCreditCoinEventId(creditKey)
  const eventDone = Boolean(store?.events?.[eventId]?.done)
  const fullyApplied = isCreditFullyApplied(store, existing, creditKey, coinAmount)

  return {
    telegramUserId: tgId,
    username: user?.username || null,
    userExists: Boolean(user),
    amount,
    coinAmount,
    creditKey,
    coinEventId: coinAmount > 0 ? coinEventId : null,
    contestId: spec?.contestId || null,
    note: spec?.note || null,
    wouldCreatePhantomUsers: false,
    wouldTouchStoreReferrals: false,
    wouldGrantCoins: coinAmount > 0 && !existing?.coinsGranted,
    wouldBumpReferralEarnings: coinAmount > 0 && !existing?.referralEarningsGranted,
    wouldCallActivateReferral: false,
    alreadyApplied: fullyApplied,
    referralCreditApplied: eventDone || existing?.creditKey === creditKey,
    coinsGranted: Boolean(existing?.coinsGranted),
    referralEarningsGranted: Boolean(existing?.referralEarningsGranted),
    existingCreditKey: existing?.creditKey || null,
    currentManualAmount: getManualReferralCreditAmount(store, tgId),
    currentBalance: user?.balance ?? null,
    currentReferralEarnings: user?.referralEarnings ?? null,
  }
}
