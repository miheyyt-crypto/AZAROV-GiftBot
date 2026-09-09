import { getUserOrders, normalizeOrderStatus } from './shop.mjs'
import { listUserInventoryItems } from './inventory.mjs'
import {
  ACHIEVEMENTS,
  achievementClaimEventId,
  findAchievement,
} from './achievements.mjs'
import { withStore, withStoreRead } from './store.mjs'
import { getReferralsByReferrer } from './users.mjs'
import { addCoins, hasEvent, listUserTransactions, normalizeTxType, TX_TYPE } from './wallet.mjs'

const CASE_NAMES = {
  poor: 'Нищий кейс',
  medium: 'Средний кейс',
  rich: 'Блатной кейс',
  referral: 'Реферальный кейс',
}

export { ACHIEVEMENTS, findAchievement, achievementClaimEventId } from './achievements.mjs'

const TRANSACTION_LABELS = {
  task_reward: 'Награда за задание',
  referral_reward: 'Награда за реферала',
  partner_reward: 'Награда за партнёрское задание',
  case_reward: 'Выигрыш из кейса',
  case_purchase: 'Открытие кейса',
  shop_purchase: 'Покупка в магазине',
  streak_freeze: 'Заморозка стрика',
  achievement_reward: 'Награда за достижение',
  giveaway_reward: 'Победа в розыгрыше',
  level_reward: 'Награда за уровень',
  mines_bet: 'Ставка в Mines',
  mines_win: 'Выигрыш в Mines',
  tower_bet: 'Ставка в Tower',
  tower_win: 'Выигрыш в Tower',
  admin_adjustment: 'Корректировка баланса',
  refund: 'Возврат',
}

const PURCHASE_TYPES = new Set(['case_purchase', 'shop_purchase', 'mines_bet', 'tower_bet'])
const REWARD_TYPES = new Set([
  'task_reward',
  'referral_reward',
  'partner_reward',
  'case_reward',
  'achievement_reward',
  'giveaway_reward',
  'level_reward',
  'mines_win',
  'tower_win',
])

function getCaseName(caseId) {
  return CASE_NAMES[caseId] || caseId
}

function labelForType(type, item) {
  if (item?.description) {
    return item.description
  }
  const normalized = normalizeTxType(type)
  return TRANSACTION_LABELS[normalized] || normalized
}

function sumEarnedCoins(store, userId) {
  return listUserTransactions(store, userId)
    .filter((item) => item.amount > 0)
    .reduce((sum, item) => sum + item.amount, 0)
}

export function readAchievementProgress(store, user) {
  user.claimedAchievements = user.claimedAchievements || []
  user.chatMessages = Math.max(0, Math.floor(Number(user.chatMessages) || 0))

  const watchRaw =
    store.kickWatchStats?.[String(user.telegramId)]?.totalWatchSeconds ?? user.watchSeconds
  const watchSeconds = Math.max(0, Math.floor(Number(watchRaw) || 0))
  if (watchRaw != null) {
    user.watchSeconds = watchSeconds
  }

  // Prefer derived hours from watchSeconds; keep legacy streamHours as a floor for old data/tests.
  const derivedHours = Math.floor(watchSeconds / 3600)
  const legacyHours = Math.max(0, Math.floor(Number(user.streamHours) || 0))
  user.streamHours = Math.max(derivedHours, legacyHours)

  const invitedCount = getReferralsByReferrer(store, user.telegramId).length
  const coinsEarned = sumEarnedCoins(store, user.telegramId)

  const progressMap = {
    'stream-hours': user.streamHours,
    'chat-messages': user.chatMessages,
    friends: invitedCount,
    'coins-earned': coinsEarned,
  }

  return ACHIEVEMENTS.map((item) => {
    const raw = Number(progressMap[item.id] ?? 0) || 0
    const completed = raw >= item.target
    const claimed = user.claimedAchievements.includes(item.id)
    let status = 'in_progress'
    if (claimed) {
      status = 'claimed'
    } else if (completed) {
      status = 'claimable'
    }

    return {
      ...item,
      current: Math.min(raw, item.target),
      completed,
      claimed,
      status,
    }
  })
}

export function getCoinHistory(userId, filter = 'all') {
  return withStoreRead((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return { success: false, message: 'Пользователь не найден.', transactions: [] }
    }

    let transactions = listUserTransactions(store, userId)
      .slice()
      .reverse()
      .map((item) => ({
        id: item.id,
        amount: item.amount,
        type: normalizeTxType(item.type),
        label: labelForType(item.type, item),
        description: item.description || labelForType(item.type, item),
        referenceId: item.referenceId || null,
        balanceAfter: typeof item.balanceAfter === 'number' ? item.balanceAfter : null,
        createdAt: item.createdAt,
      }))

    if (filter === 'income') {
      transactions = transactions.filter((item) => item.amount > 0)
    }

    if (filter === 'expense') {
      transactions = transactions.filter((item) => item.amount < 0)
    }

    if (filter === 'purchases') {
      transactions = transactions.filter((item) => PURCHASE_TYPES.has(item.type))
    }

    if (filter === 'rewards') {
      transactions = transactions.filter((item) => REWARD_TYPES.has(item.type))
    }

    return { success: true, transactions }
  })
}

export function getInventory(userId) {
  return withStoreRead((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return {
        success: false,
        message: 'Пользователь не найден.',
        items: [],
        caseOpenings: [],
      }
    }

    const openings = (Array.isArray(user.caseOpenings) ? user.caseOpenings : [])
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const caseOpenings = openings.map((opening) => ({
      id: opening.openingId,
      name: opening.prize?.name || `${opening.rewardAmount}`,
      amount: opening.rewardAmount,
      currency: opening.rewardCurrency,
      caseId: opening.caseId,
      caseName: getCaseName(opening.caseId),
      rarity: opening.prize?.rarity || 'common',
      createdAt: opening.createdAt,
    }))

    const inventoryRows = listUserInventoryItems(store, userId)
    const availableFreezes = inventoryRows.filter(
      (item) =>
        String(item.type) === 'streak-freeze' && String(item.status) === 'available',
    )
    const otherItems = inventoryRows.filter(
      (item) =>
        !(String(item.type) === 'streak-freeze' && String(item.status) === 'available'),
    )

    const items = []

    if (availableFreezes.length > 0) {
      const sorted = availableFreezes
        .slice()
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      items.push({
        itemId: 'streak-freeze',
        type: 'streak-freeze',
        status: 'available',
        quantity: availableFreezes.length,
        sourceOrderId: null,
        createdAt: sorted[0].createdAt,
        consumedAt: null,
        name: 'Заморозка стрика',
        metadata: {},
      })
    }

    for (const item of otherItems) {
      // Consumed freezes are not listed — user only sees available × N.
      if (String(item.type) === 'streak-freeze') {
        continue
      }
      items.push({
        itemId: item.itemId,
        type: item.type,
        status: item.status,
        quantity: 1,
        sourceOrderId: item.sourceOrderId || null,
        createdAt: item.createdAt,
        consumedAt: item.consumedAt || null,
        name: String(item.type || 'Предмет'),
        metadata: item.metadata || {},
      })
    }

    return { success: true, items, caseOpenings }
  })
}

export function getAchievementsProgress(userId) {
  return withStoreRead((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return { success: false, message: 'Пользователь не найден.', achievements: [] }
    }

    return { success: true, achievements: readAchievementProgress(store, user) }
  })
}

/**
 * Claim achievement reward. Server-authoritative reward/target.
 * Idempotent via ledger event `achievement:claim:{userId}:{achievementId}`.
 */
export function claimAchievementOnStore(store, userId, achievementId) {
  const definition = findAchievement(achievementId)
  if (!definition) {
    return { success: false, code: 'UNKNOWN_ACHIEVEMENT', message: 'Достижение не найдено.' }
  }

  const user = store.users[String(userId)]
  if (!user) {
    return { success: false, message: 'Пользователь не найден.' }
  }

  user.claimedAchievements = user.claimedAchievements || []
  const eventId = achievementClaimEventId(user.telegramId, definition.id)
  const progressList = readAchievementProgress(store, user)
  const progress = progressList.find((item) => item.id === definition.id)

  if (!progress) {
    return { success: false, code: 'UNKNOWN_ACHIEVEMENT', message: 'Достижение не найдено.' }
  }

  if (progress.claimed || hasEvent(store, eventId)) {
    if (!user.claimedAchievements.includes(definition.id)) {
      user.claimedAchievements = [...user.claimedAchievements, definition.id]
    }
    const refreshed = readAchievementProgress(store, user).find((item) => item.id === definition.id)
    return {
      success: true,
      alreadyClaimed: true,
      rewarded: false,
      reward: 0,
      message: 'Награда за это достижение уже получена.',
      achievement: refreshed,
      achievements: readAchievementProgress(store, user),
    }
  }

  if (!progress.completed) {
    return {
      success: false,
      code: 'NOT_COMPLETED',
      message: 'Цель ещё не достигнута.',
      achievement: progress,
      achievements: progressList,
    }
  }

  // Reward amount is server-only — never from client body.
  const grant = addCoins(store, user, definition.reward, TX_TYPE.ACHIEVEMENT_REWARD, eventId, {
    referenceId: definition.id,
    description: `Награда за достижение: ${definition.title}`,
  })

  if (!grant.granted && grant.reason !== 'already_granted') {
    return {
      success: false,
      message: 'Не удалось начислить награду.',
      achievements: readAchievementProgress(store, user),
    }
  }

  if (!user.claimedAchievements.includes(definition.id)) {
    user.claimedAchievements = [...user.claimedAchievements, definition.id]
  }

  const refreshedList = readAchievementProgress(store, user)
  const refreshed = refreshedList.find((item) => item.id === definition.id)

  return {
    success: true,
    alreadyClaimed: grant.reason === 'already_granted',
    rewarded: grant.granted,
    reward: grant.granted ? definition.reward : 0,
    message: grant.granted
      ? `Начислено ${definition.reward.toLocaleString('ru-RU')} 🪙`
      : 'Награда за это достижение уже получена.',
    achievement: refreshed,
    achievements: refreshedList,
  }
}

export function claimAchievement(userId, achievementId) {
  return withStore((store) => claimAchievementOnStore(store, userId, achievementId))
}

export function getPendingOrders(userId) {
  const result = getUserOrders(userId)
  if (!result.success) {
    return result
  }

  const orders = (result.orders || []).filter((order) => {
    const status = normalizeOrderStatus(order.status)
    return status === 'pending' || status === 'processing'
  })

  return { success: true, orders }
}
