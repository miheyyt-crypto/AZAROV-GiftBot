/**
 * One-time coin rewards for reaching levels.
 * Formula: reward = level * 50. Does not change XP / level calculation.
 */

import { buildUserLevelSnapshot } from './level.mjs'
import { createNotificationOnStore, NOTIFICATION_TYPE } from './notifications.mjs'
import { addCoins, hasEvent, TX_TYPE } from './wallet.mjs'

export const LEVEL_REWARD_COINS_PER_LEVEL = 50

export function levelRewardAmount(level) {
  const value = Math.floor(Number(level) || 0)
  if (value < 1) {
    return 0
  }
  return value * LEVEL_REWARD_COINS_PER_LEVEL
}

export function levelRewardEventId(userId, level) {
  return `level_reward:${Number(userId)}:${Math.floor(Number(level) || 0)}`
}

export function normalizeClaimedLevelRewards(user) {
  const raw = Array.isArray(user?.claimedLevelRewards) ? user.claimedLevelRewards : []
  const set = new Set()
  for (const item of raw) {
    const level = Math.floor(Number(item) || 0)
    if (level >= 1) {
      set.add(level)
    }
  }
  return set
}

export function writeClaimedLevelRewards(user, claimedSet) {
  if (!user) {
    return
  }
  user.claimedLevelRewards = [...claimedSet].sort((a, b) => a - b)
}

/**
 * Mark levels 1..currentLevel as already claimed without paying.
 * Used for existing users at feature rollout and as a safety net.
 */
export function seedClaimedLevelRewardsWithoutGrant(user, currentLevel) {
  if (!user) {
    return { seeded: false, claimedThrough: 0 }
  }
  const through = Math.max(1, Math.floor(Number(currentLevel) || 1))
  const claimed = normalizeClaimedLevelRewards(user)
  for (let level = 1; level <= through; level += 1) {
    claimed.add(level)
  }
  writeClaimedLevelRewards(user, claimed)
  user.levelRewardsSeeded = true
  user.peakLevel = Math.max(Number(user.peakLevel) || 0, through)
  return { seeded: true, claimedThrough: through }
}

export function resolveUserLevelForRewards(store, user) {
  const watchSeconds = Math.max(
    0,
    Math.floor(
      Number(store?.kickWatchStats?.[String(user.telegramId)]?.totalWatchSeconds ?? user.watchSeconds) ||
        0,
    ),
  )
  const snap = buildUserLevelSnapshot(user, watchSeconds)
  return { ...snap, watchSeconds }
}

function markLevelClaimed(user, claimed, level) {
  claimed.add(level)
  writeClaimedLevelRewards(user, claimed)
}

function formatLevelUpMessage(rewards, totalAmount) {
  const lines = rewards.map(
    (item) => `Уровень ${item.level}: +${item.amount.toLocaleString('ru-RU')} 🪙`,
  )
  if (rewards.length > 1) {
    lines.push(`Итого: +${totalAmount.toLocaleString('ru-RU')} 🪙`)
  }
  return lines.join('\n')
}

/**
 * Grant missing level rewards up to the user's current level.
 * Idempotent via claimedLevelRewards + ledger eventId.
 */
export function grantPendingLevelRewardsOnStore(store, user) {
  if (!user?.telegramId) {
    return {
      granted: [],
      totalAmount: 0,
      level: 1,
      notification: null,
    }
  }

  // Safety net: never backfill unknown legacy accounts.
  if (!user.levelRewardsSeeded) {
    const { level } = resolveUserLevelForRewards(store, user)
    seedClaimedLevelRewardsWithoutGrant(user, level)
    return {
      granted: [],
      totalAmount: 0,
      level,
      notification: null,
      seededWithoutGrant: true,
    }
  }

  const snap = resolveUserLevelForRewards(store, user)
  const currentLevel = Math.max(1, Math.floor(Number(snap.level) || 1))
  const claimed = normalizeClaimedLevelRewards(user)
  const granted = []

  for (let level = 1; level <= currentLevel; level += 1) {
    if (claimed.has(level)) {
      continue
    }

    const eventId = levelRewardEventId(user.telegramId, level)
    const amount = levelRewardAmount(level)
    if (amount <= 0) {
      markLevelClaimed(user, claimed, level)
      continue
    }

    if (hasEvent(store, eventId)) {
      markLevelClaimed(user, claimed, level)
      continue
    }

    const result = addCoins(store, user, amount, TX_TYPE.LEVEL_REWARD, eventId, {
      referenceId: `level:${level}`,
      description: `Награда за уровень ${level}`,
      level,
    })

    markLevelClaimed(user, claimed, level)

    if (result.granted) {
      granted.push({ level, amount })
    }
  }

  let notification = null
  if (granted.length > 0) {
    const totalAmount = granted.reduce((sum, item) => sum + item.amount, 0)
    const maxLevel = granted[granted.length - 1].level
    const title = granted.length === 1 ? 'Новый уровень!' : 'Новые уровни!'
    const created = createNotificationOnStore(store, {
      userId: user.telegramId,
      type: NOTIFICATION_TYPE.LEVEL_UP,
      title,
      message: formatLevelUpMessage(granted, totalAmount),
      eventKey: `level_up:${user.telegramId}:${granted.map((item) => item.level).join('-')}`,
      relatedEntityType: 'level',
      relatedEntityId: String(maxLevel),
      metadata: {
        rewards: granted,
        totalAmount,
        level: maxLevel,
        reward: totalAmount,
      },
    })
    notification = created.notification
  }

  return {
    granted,
    totalAmount: granted.reduce((sum, item) => sum + item.amount, 0),
    level: currentLevel,
    notification,
  }
}

export function nextLevelRewardAmount(currentLevel) {
  return levelRewardAmount(Math.max(1, Math.floor(Number(currentLevel) || 1)) + 1)
}
