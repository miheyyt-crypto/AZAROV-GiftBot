import { createHash, randomInt } from 'node:crypto'

import { withStore } from './store.mjs'
import { toPublicUser } from './users.mjs'
import { addCoins, TX_TYPE } from './wallet.mjs'
import { roundGram } from './gram.mjs'
import {
  DAILY_FREE_CASE_COOLDOWN_MS,
  DAILY_FREE_CASE_REWARDS,
  getDailyFreeCaseAvailability,
  getDailyFreeCaseRequirementDenial,
  getDailyFreeCaseRequirements,
  getDailyFreeCaseRewardById,
  getDailyFreeCaseRewardsFlat,
  listDailyFreeCaseRarities,
  rollDailyFreeCaseReward,
} from './daily-free-case-config.mjs'

function requestEventKey(userId, requestId) {
  return `daily-free-case:request:${userId}:${requestId}`
}

function rewardEventKey(openingId) {
  return `${openingId}:reward`
}

function pickWeightedInt(items, weightOf) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0)
  if (total <= 0) {
    return items[items.length - 1] || null
  }
  let cursor = randomInt(total)
  for (const item of items) {
    cursor -= weightOf(item)
    if (cursor < 0) {
      return item
    }
  }
  return items[items.length - 1] || null
}

function cryptoRoll() {
  const rarities = listDailyFreeCaseRarities()
  const rarity = pickWeightedInt(rarities, (item) => item.rollWeight)
  if (!rarity?.rewards?.length) {
    return getDailyFreeCaseRewardsFlat()[0]
  }
  const reward = pickWeightedInt(rarity.rewards, (item) => item.weight)
  return {
    ...reward,
    rarity: rarity.id,
    rarityName: rarity.name,
    rarityChance: rarity.chance,
  }
}

function publicReward(reward) {
  return {
    id: reward.id,
    name: reward.name,
    amount: reward.amount,
    emoji: reward.emoji,
    rewardType: reward.rewardType,
    valueLabel: reward.valueLabel,
    rarity: reward.rarity,
    rarityName: reward.rarityName,
    rarityChance: reward.rarityChance,
  }
}

function grantDailyFreeCaseReward(store, user, reward, openingId) {
  const type = String(reward.rewardType || '').toUpperCase()

  if (type === 'COINS') {
    const amount = Math.floor(Number(reward.amount) || 0)
    if (amount < 1) {
      return { ok: false, reason: 'invalid_coins' }
    }
    const credit = addCoins(store, user, amount, TX_TYPE.CASE_REWARD, rewardEventKey(openingId), {
      referenceId: openingId,
      source: 'daily_free_case',
      rewardId: reward.id,
    })
    if (!credit.granted && credit.reason !== 'already_granted') {
      return { ok: false, reason: credit.reason || 'credit_failed' }
    }
    return { ok: true, credited: 'COINS', amount }
  }

  if (type === 'GRAM') {
    const amount = Number(reward.amount)
    if (!(amount > 0)) {
      return { ok: false, reason: 'invalid_gram' }
    }
    user.gramBalance = roundGram((Number(user.gramBalance) || 0) + amount)
    store.events = store.events || {}
    store.events[rewardEventKey(openingId)] = {
      eventId: rewardEventKey(openingId),
      done: true,
      type: 'DAILY_FREE_CASE_GRAM',
      userId: user.telegramId,
      amount,
      rewardId: reward.id,
      createdAt: new Date().toISOString(),
    }
    return { ok: true, credited: 'GRAM', amount }
  }

  if (type === 'ITEM') {
    user.dailyCaseItems = Array.isArray(user.dailyCaseItems) ? user.dailyCaseItems : []
    user.dailyCaseItems.push({
      itemId: `${openingId}:item`,
      rewardId: reward.id,
      name: reward.name,
      createdAt: new Date().toISOString(),
    })
    store.events = store.events || {}
    store.events[rewardEventKey(openingId)] = {
      eventId: rewardEventKey(openingId),
      done: true,
      type: 'DAILY_FREE_CASE_ITEM',
      userId: user.telegramId,
      rewardId: reward.id,
      createdAt: new Date().toISOString(),
    }
    return { ok: true, credited: 'ITEM', amount: 0 }
  }

  return { ok: false, reason: 'unknown_type' }
}

function buildStatusPayload(user) {
  const availability = getDailyFreeCaseAvailability(user)
  const requirements = getDailyFreeCaseRequirements(user)
  return {
    available: availability.available,
    availableAt: availability.availableAt,
    canOpen: requirements.canOpen,
    cooldownMs: DAILY_FREE_CASE_COOLDOWN_MS,
    requirements: {
      kickLinked: requirements.kickLinked,
      telegramTaskCompleted: requirements.telegramTaskCompleted,
      cooldownExpired: requirements.cooldownExpired,
      canOpen: requirements.canOpen,
    },
    rewards: getDailyFreeCaseRewardsFlat().map((item) => publicReward(item)),
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
 * - rolls reward by rarity chance + item weight
 * - grants coins / gram / item
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

    const denial = getDailyFreeCaseRequirementDenial(user)
    if (denial) {
      return {
        ...denial,
        ...buildStatusPayload(user),
        user: toPublicUser(user, store),
      }
    }

    const availability = getDailyFreeCaseAvailability(user)
    if (!availability.available) {
      return {
        success: false,
        canOpen: false,
        code: 'COOLDOWN',
        reason: 'COOLDOWN',
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

    const previousLastAt = user.lastDailyFreeCaseAt || null
    user.lastDailyFreeCaseAt = nowIso
    user.dailyFreeCaseOpenings = Array.isArray(user.dailyFreeCaseOpenings)
      ? user.dailyFreeCaseOpenings
      : []
    user.dailyFreeCaseOpenings.push({
      openingId,
      rewardId: reward.id,
      rewardType: reward.rewardType,
      amount: reward.amount,
      requestId,
      createdAt: nowIso,
    })

    const grant = grantDailyFreeCaseReward(store, user, reward, openingId)
    if (!grant.ok) {
      user.lastDailyFreeCaseAt = previousLastAt
      user.dailyFreeCaseOpenings = user.dailyFreeCaseOpenings.filter(
        (item) => item.openingId !== openingId,
      )
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
      rewards: getDailyFreeCaseRewardsFlat().map((item) => publicReward(item)),
      user: toPublicUser(store.users[String(userId)], store),
    }
  })
}

export {
  DAILY_FREE_CASE_COOLDOWN_MS,
  DAILY_FREE_CASE_REWARDS,
  getDailyFreeCaseAvailability,
  getDailyFreeCaseRequirementDenial,
  getDailyFreeCaseRequirements,
  getDailyFreeCaseRewardById,
  rollDailyFreeCaseReward,
}
