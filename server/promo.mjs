import crypto from 'node:crypto'

import { withStore, withStoreRead } from './store.mjs'
import { addCoins, TX_TYPE, utcNow } from './wallet.mjs'

export const PROMO_CODE_MIN_LENGTH = 3
export const PROMO_CODE_MAX_LENGTH = 32
export const PROMO_REWARD_MAX = 10_000_000
export const PROMO_MAX_USES_MAX = 1_000_000

function ensureMaps(store) {
  store.promoCodes = store.promoCodes || {}
  store.promoUsages = store.promoUsages || {}
  store.events = store.events || {}
}

/** Normalize user/admin input to canonical uppercase code. */
export function normalizePromoCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

export function isValidPromoCodeFormat(code) {
  const normalized = normalizePromoCode(code)
  if (
    normalized.length < PROMO_CODE_MIN_LENGTH ||
    normalized.length > PROMO_CODE_MAX_LENGTH
  ) {
    return false
  }
  return /^[A-Z0-9_-]+$/.test(normalized)
}

export function promoUsageKey(code, userId) {
  return `${normalizePromoCode(code)}:${Number(userId)}`
}

export function promoRewardEventId(code, userId) {
  return `promo:${normalizePromoCode(code)}:${Number(userId)}`
}

function remainingUses(promo) {
  const maxUses = Math.max(0, Math.floor(Number(promo.maxUses) || 0))
  const usedCount = Math.max(0, Math.floor(Number(promo.usedCount) || 0))
  return Math.max(0, maxUses - usedCount)
}

export function publicPromo(promo) {
  if (!promo) {
    return null
  }
  const maxUses = Math.max(0, Math.floor(Number(promo.maxUses) || 0))
  const usedCount = Math.max(0, Math.floor(Number(promo.usedCount) || 0))
  return {
    code: promo.code,
    reward: Math.max(0, Math.floor(Number(promo.reward) || 0)),
    maxUses,
    usedCount,
    remainingUses: Math.max(0, maxUses - usedCount),
    active: Boolean(promo.active),
    createdAt: promo.createdAt || null,
    createdBy: promo.createdBy == null ? null : Number(promo.createdBy),
    deactivatedAt: promo.deactivatedAt || null,
  }
}

export function createPromoCodeOnStore(store, input = {}) {
  ensureMaps(store)

  const code = normalizePromoCode(input.code)
  if (!isValidPromoCodeFormat(code)) {
    return {
      success: false,
      code: 'INVALID_CODE',
      message: 'Введите корректный промокод (3–32 символа: A-Z, 0-9, _ или -).',
    }
  }

  const reward = Math.floor(Number(input.reward))
  if (!Number.isInteger(reward) || reward < 1) {
    return {
      success: false,
      code: 'INVALID_REWARD',
      message: 'Награда должна быть целым числом больше 0.',
    }
  }
  if (reward > PROMO_REWARD_MAX) {
    return {
      success: false,
      code: 'INVALID_REWARD',
      message: `Награда не может превышать ${PROMO_REWARD_MAX}.`,
    }
  }

  const maxUses = Math.floor(Number(input.maxUses))
  if (!Number.isInteger(maxUses) || maxUses < 1) {
    return {
      success: false,
      code: 'INVALID_MAX_USES',
      message: 'Количество использований должно быть целым числом ≥ 1.',
    }
  }
  if (maxUses > PROMO_MAX_USES_MAX) {
    return {
      success: false,
      code: 'INVALID_MAX_USES',
      message: `Количество использований не может превышать ${PROMO_MAX_USES_MAX}.`,
    }
  }

  if (store.promoCodes[code]) {
    return {
      success: false,
      code: 'PROMO_EXISTS',
      message: 'Такой промокод уже существует.',
    }
  }

  const createdBy = Number(input.createdBy)
  const promo = {
    code,
    reward,
    maxUses,
    usedCount: 0,
    active: true,
    createdAt: utcNow(),
    createdBy: Number.isInteger(createdBy) && createdBy > 0 ? createdBy : null,
    deactivatedAt: null,
  }

  store.promoCodes[code] = promo

  return {
    success: true,
    promo: publicPromo(promo),
  }
}

export function createPromoCode(input = {}) {
  return withStore((store) => createPromoCodeOnStore(store, input))
}

export function listPromoCodesOnStore(store) {
  ensureMaps(store)
  return Object.values(store.promoCodes || {})
    .map((promo) => publicPromo(promo))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

export function listPromoCodes() {
  return withStoreRead((store) => listPromoCodesOnStore(store))
}

export function deactivatePromoCodeOnStore(store, rawCode) {
  ensureMaps(store)
  const code = normalizePromoCode(rawCode)
  const promo = store.promoCodes[code]
  if (!promo) {
    return {
      success: false,
      code: 'PROMO_NOT_FOUND',
      message: 'Промокод не найден.',
    }
  }
  if (!promo.active) {
    return {
      success: true,
      alreadyInactive: true,
      promo: publicPromo(promo),
    }
  }
  promo.active = false
  promo.deactivatedAt = utcNow()
  return {
    success: true,
    alreadyInactive: false,
    promo: publicPromo(promo),
  }
}

export function deactivatePromoCode(rawCode) {
  return withStore((store) => deactivatePromoCodeOnStore(store, rawCode))
}

export function redeemPromoCodeOnStore(store, userId, rawCode) {
  ensureMaps(store)

  const uid = Number(userId)
  if (!Number.isInteger(uid) || uid <= 0) {
    return {
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Не удалось определить пользователя.',
    }
  }

  const code = normalizePromoCode(rawCode)
  if (!isValidPromoCodeFormat(code)) {
    return {
      success: false,
      code: 'INVALID_CODE',
      message: 'Введи корректный промокод',
    }
  }

  const user = store.users?.[String(uid)]
  if (!user) {
    return {
      success: false,
      code: 'USER_NOT_FOUND',
      message: 'Пользователь не найден.',
    }
  }

  const promo = store.promoCodes[code]
  if (!promo) {
    return {
      success: false,
      code: 'PROMO_NOT_FOUND',
      message: 'Промокод не найден',
    }
  }

  if (!promo.active) {
    return {
      success: false,
      code: 'PROMO_DISABLED',
      message: 'Этот промокод больше не активен',
    }
  }

  const usageKey = promoUsageKey(code, uid)
  if (store.promoUsages[usageKey]) {
    return {
      success: false,
      code: 'PROMO_ALREADY_USED',
      message: 'Ты уже использовал этот промокод',
    }
  }

  if (remainingUses(promo) <= 0) {
    return {
      success: false,
      code: 'PROMO_EXHAUSTED',
      message: 'Этот промокод больше недоступен',
    }
  }

  const reward = Math.max(0, Math.floor(Number(promo.reward) || 0))
  if (reward < 1) {
    return {
      success: false,
      code: 'PROMO_DISABLED',
      message: 'Этот промокод больше не активен',
    }
  }

  const eventId = promoRewardEventId(code, uid)
  const usedAt = utcNow()

  // Reserve usage first (unique key), then credit — all inside the same locked withStore.
  store.promoUsages[usageKey] = {
    id: usageKey,
    code,
    userId: uid,
    reward,
    eventId,
    usedAt,
  }
  promo.usedCount = Math.max(0, Math.floor(Number(promo.usedCount) || 0)) + 1

  const grant = addCoins(store, user, reward, TX_TYPE.PROMO_REWARD, eventId, {
    referenceId: code,
    description: `Промокод ${code}`,
  })

  if (!grant.granted && grant.reason !== 'already_granted') {
    // Roll back reservation if ledger refused the credit.
    delete store.promoUsages[usageKey]
    promo.usedCount = Math.max(0, Math.floor(Number(promo.usedCount) || 0) - 1)
    return {
      success: false,
      code: 'REDEEM_FAILED',
      message: 'Не удалось активировать промокод. Попробуй ещё раз.',
    }
  }

  return {
    success: true,
    code: 'OK',
    reward,
    newBalance: Number(grant.user.balance || 0),
    promo: publicPromo(promo),
    alreadyProcessed: grant.reason === 'already_granted',
    message: `Промокод активирован! +${reward} монет`,
  }
}

export function redeemPromoCode(userId, rawCode) {
  return withStore((store) => redeemPromoCodeOnStore(store, userId, rawCode))
}

export function createPromoId() {
  return `promo_${crypto.randomBytes(8).toString('hex')}`
}
