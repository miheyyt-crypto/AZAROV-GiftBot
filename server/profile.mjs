import { getUserOrders, normalizeOrderStatus } from './shop.mjs'
import { withStoreRead } from './store.mjs'
import { getReferralsByReferrer } from './users.mjs'
import { listUserTransactions, normalizeTxType } from './wallet.mjs'

const CASE_NAMES = {
  poor: 'Нищий кейс',
  medium: 'Средний кейс',
  rich: 'Блатной кейс',
  referral: 'Реферальный кейс',
}

const ACHIEVEMENTS = [
  {
    id: 'stream-hours',
    title: '100 часов просмотра',
    reward: 5000,
    target: 100,
    icon: 'clock',
  },
  {
    id: 'chat-messages',
    title: '1 000 сообщений',
    reward: 3000,
    target: 1000,
    icon: 'message',
  },
  {
    id: 'friends',
    title: '10 друзей',
    reward: 4000,
    target: 10,
    icon: 'users',
  },
  {
    id: 'coins-earned',
    title: '100 000 монет заработано',
    reward: 5000,
    target: 100_000,
    icon: 'coins',
  },
]

const TRANSACTION_LABELS = {
  task_reward: 'Награда за задание',
  referral_reward: 'Награда за реферала',
  partner_reward: 'Награда за партнёрское задание',
  case_reward: 'Выигрыш из кейса',
  case_purchase: 'Открытие кейса',
  shop_purchase: 'Покупка в магазине',
  admin_adjustment: 'Корректировка баланса',
  refund: 'Возврат',
}

const PURCHASE_TYPES = new Set(['case_purchase', 'shop_purchase'])
const REWARD_TYPES = new Set([
  'task_reward',
  'referral_reward',
  'partner_reward',
  'case_reward',
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
      return { success: false, message: 'Пользователь не найден.', items: [] }
    }

    const openings = (user.caseOpenings || [])
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const items = openings.map((opening) => ({
      id: opening.openingId,
      name: opening.prize?.name || `${opening.rewardAmount}`,
      amount: opening.rewardAmount,
      currency: opening.rewardCurrency,
      caseId: opening.caseId,
      caseName: getCaseName(opening.caseId),
      rarity: opening.prize?.rarity || 'common',
      createdAt: opening.createdAt,
    }))

    return { success: true, items }
  })
}

function sumEarnedCoins(store, userId) {
  return listUserTransactions(store, userId)
    .filter((item) => item.amount > 0)
    .reduce((sum, item) => sum + item.amount, 0)
}

export function getAchievementsProgress(userId) {
  return withStoreRead((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return { success: false, message: 'Пользователь не найден.', achievements: [] }
    }

    user.claimedAchievements = user.claimedAchievements || []
    user.streamHours = user.streamHours || 0
    user.chatMessages = user.chatMessages || 0

    const invitedCount = getReferralsByReferrer(store, user.telegramId).length
    const coinsEarned = sumEarnedCoins(store, userId)

    const progressMap = {
      'stream-hours': user.streamHours,
      'chat-messages': user.chatMessages,
      friends: invitedCount,
      'coins-earned': coinsEarned,
    }

    const list = ACHIEVEMENTS.map((item) => {
      const current = progressMap[item.id] ?? 0
      const completed = current >= item.target
      const claimed = user.claimedAchievements.includes(item.id)

      return {
        ...item,
        current: Math.min(current, item.target),
        completed,
        claimed,
      }
    })

    return { success: true, achievements: list }
  })
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
