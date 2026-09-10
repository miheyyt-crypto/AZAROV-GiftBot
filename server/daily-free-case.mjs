import { createHash, randomInt } from 'node:crypto'

import { withStore } from './store.mjs'
import { toPublicUser } from './users.mjs'
import { addCoins, TX_TYPE } from './wallet.mjs'
import {
  DAILY_FREE_CASE_COOLDOWN_MS,
  DAILY_FREE_CASE_REWARDS,
  getDailyFreeCaseAvailability,
  getDailyFreeCaseRewardById,
  rollDailyFreeCaseReward,
} from './daily-free-case-config.mjs'

function requestEventKey(userId, requestId) {
  return `daily-free-case:request:${userId}:${requestId}`
}

function rewardEventKey(openingId) {
  return `${openingId}:reward`
}

function cryptoRoll() {
  const total = DAILY_FREE_CASE_REWARDS.reduce((sum, item) => sum + item.weight, 0)
  let cursor = randomInt(total)
  for (const item of DAILY_FREE_CASE_REWARDS) {
    cursor -= item.weight
    if (cursor < 0) {
      return item
    }
  }
  return DAILY_FREE_CASE_REWARDS[DAILY_FREE_CASE_REWARDS.length - 1]
}

function publicReward(reward) {
  return {
    id: reward.id,
    name: reward.name,
    amount: reward.amount,
    emoji: reward.emoji,
  }
}

function buildStatusPayload(user) {
  const availability = getDailyFreeCaseAvailability(user)
  return {
    available: availability.available,
    availableAt: availability.availableAt,
    cooldownMs: DAILY_FREE_CASE_COOLDOWN_MS,
    rewards: DAILY_FREE_CASE_REWARDS.map((item) => publicReward(item)),
  }
}

export function getDailyFreeCaseStatus(userId) {
  return withStore((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return { success: false, message: 'Пользователь не найден.', code: 'USER_NOT_FOUND' }
    }
    return {
      success: true,
      ...buildStatusPayload(user),
      user: toPublicUser(user, store),
    }
  }, { readOnly: true })
}

/**
 * Server-authoritative free daily spin:
 * - rolls reward
 * - credits coins once
 * - starts 24h cooldown
 * - idempotent by requestId
 */
export function openDailyFreeCase(userId, requestId) {
  return withStore((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return { success: false, message: 'Пользователь не найден.', code: 'USER_NOT_FOUND' }
    }

    store.events = store.events || {}
    const reqKey = requestEventKey(userId, requestId)
    const existing = store.events[reqKey]
    if (existing?.done && existing.result) {
      return {
        success: true,
        alreadyProcessed: true,
        ...existing.result,
        user: toPublicUser(store.users[String(userId)], store),
      }
    }

    const availability = getDailyFreeCaseAvailability(user)
    if (!availability.available) {
      return {
        success: false,
        code: 'COOLDOWN',
        message: 'Бесплатный кейс будет доступен позже.',
        availableAt: availability.availableAt,
        ...buildStatusPayload(user),
        user: toPublicUser(user, store),
      }
    }

    const reward = cryptoRoll()
    const nowIso = new Date().toISOString()
    const openingId = `daily-free-case:${userId}:${createHash('sha256')
      .update(`${requestId}:${nowIso}`)
      .digest('hex')
      .slice(0, 24)}`

    user.lastDailyFreeCaseAt = nowIso
    user.dailyFreeCaseOpenings = Array.isArray(user.dailyFreeCaseOpenings)
      ? user.dailyFreeCaseOpenings
      : []
    user.dailyFreeCaseOpenings.push({
      openingId,
      rewardId: reward.id,
      amount: reward.amount,
      requestId,
      createdAt: nowIso,
    })

    const credit = addCoins(store, user, reward.amount, TX_TYPE.CASE_REWARD, rewardEventKey(openingId), {
      referenceId: openingId,
      source: 'daily_free_case',
      rewardId: reward.id,
    })

    if (!credit.granted && credit.reason !== 'duplicate') {
      // Roll back cooldown if ledger refused (e.g. unbound) so user can retry later.
      user.lastDailyFreeCaseAt = null
      return {
        success: false,
        code: 'REWARD_FAILED',
        message: 'Не удалось начислить награду. Попробуй позже.',
        user: toPublicUser(user, store),
      }
    }

    const nextAvailability = getDailyFreeCaseAvailability(user)
    const result = {
      openingId,
      reward: publicReward(reward),
      available: false,
      availableAt: nextAvailability.availableAt,
      cooldownMs: DAILY_FREE_CASE_COOLDOWN_MS,
    }

    store.events[reqKey] = {
      done: true,
      at: nowIso,
      result,
    }

    return {
      success: true,
      alreadyProcessed: false,
      ...result,
      rewards: DAILY_FREE_CASE_REWARDS.map((item) => publicReward(item)),
      user: toPublicUser(store.users[String(userId)], store),
    }
  })
}

export {
  DAILY_FREE_CASE_COOLDOWN_MS,
  DAILY_FREE_CASE_REWARDS,
  getDailyFreeCaseAvailability,
  getDailyFreeCaseRewardById,
  rollDailyFreeCaseReward,
}
