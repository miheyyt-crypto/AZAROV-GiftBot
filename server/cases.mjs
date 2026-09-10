import crypto from 'node:crypto'

import dropTables from '../src/data/case-drops.json' with { type: 'json' }

import { getReferralCaseStats, migrateAllReferrals } from './referrals.mjs'
import { countActiveReferrals, ensureArray } from './users.mjs'
import { addCoins, hasEvent, spendCoins, TX_TYPE, utcNow } from './wallet.mjs'
import { withStore } from './store.mjs'

const CASE_CONFIG = {
  poor: {
    id: 'poor',
    name: 'Нищий кейс',
    type: 'purchase',
    price: 8999,
    rewards: dropTables.poor,
  },
  medium: {
    id: 'medium',
    name: 'Средний кейс',
    type: 'purchase',
    price: 22222,
    rewards: dropTables.medium,
  },
  rich: {
    id: 'rich',
    name: 'Блатной кейс',
    type: 'purchase',
    price: 64999,
    rewards: dropTables.rich,
  },
  referral: {
    id: 'referral',
    name: 'Реферальный кейс',
    type: 'referral',
    price: 0,
    rewards: dropTables.referral,
  },
}

export function getChanceTotal(rewards) {
  return (rewards || []).reduce((sum, reward) => sum + Number(reward.chance || 0), 0)
}

export function isDropTableValid(rewards) {
  return getChanceTotal(rewards) === 100
}

function findCase(caseId) {
  return CASE_CONFIG[caseId] || null
}

function rollReward(rewards) {
  if (!isDropTableValid(rewards)) {
    return null
  }

  let cursor = crypto.randomInt(0, 100)

  for (const reward of rewards) {
    cursor -= reward.chance
    if (cursor < 0) {
      return reward
    }
  }

  return rewards[rewards.length - 1]
}

function publicPrize(reward) {
  return {
    id: reward.id,
    name: reward.name,
    title: reward.name,
    amount: reward.amount,
    currency: reward.currency,
    rarity: reward.rarity,
  }
}

function publicOpening(opening) {
  return {
    openingId: opening.openingId,
    caseId: opening.caseId,
    rewardId: opening.rewardId,
    rewardAmount: opening.rewardAmount,
    rewardCurrency: opening.rewardCurrency,
    pricePaid: opening.pricePaid,
    prize: opening.prize,
    createdAt: opening.createdAt,
    coinClaimStatus: opening.coinClaimStatus || null,
  }
}

function activeReferralCountForUser(store, user) {
  return countActiveReferrals(store, user.telegramId)
}

function recordReferralCaseGrant(store, user, openingId, createdAt) {
  const eventId = `${openingId}:referral_case_grant`
  if (hasEvent(store, eventId)) {
    return
  }

  const balanceAfter = Number(user.balance || 0)
  const transaction = {
    id: eventId,
    userId: user.telegramId,
    amount: 0,
    type: TX_TYPE.CASE_REWARD,
    referenceId: openingId,
    description: 'Реферальный кейс',
    balanceAfter,
    createdAt,
  }

  store.events[eventId] = {
    eventId,
    ...transaction,
  }
  store.coinTransactions = store.coinTransactions || {}
  store.coinTransactions[eventId] = transaction
}

function invalidDropTableResult(caseConfig) {
  return {
    success: false,
    code: 'INVALID_DROP_TABLE',
    message: `Таблица наград кейса «${caseConfig.name}» сейчас даёт ${getChanceTotal(caseConfig.rewards)}%, нужно ровно 100%.`,
  }
}

function saveOpeningRecord(store, user, opening) {
  store.caseOpenings = store.caseOpenings || {}
  store.caseOpenings[opening.openingId] = {
    id: opening.openingId,
    userId: user.telegramId,
    caseId: opening.caseId,
    rewardId: opening.rewardId,
    rewardAmount: opening.rewardAmount,
    rewardCurrency: opening.rewardCurrency,
    pricePaid: opening.pricePaid,
    createdAt: opening.createdAt,
    ...(opening.coinClaimStatus ? { coinClaimStatus: opening.coinClaimStatus } : {}),
  }
  const openings = ensureArray(user.caseOpenings)
  user.caseOpenings = [...openings, opening]
}

function grantReward(store, user, reward, openingId) {
  // COINS are deferred: stay in inventory until claimCaseCoins.
  if (reward.currency === 'COINS' && reward.amount > 0) {
    return
  }

  if (reward.currency === 'RUB' && reward.amount > 0) {
    user.rubleWinnings = (user.rubleWinnings || 0) + reward.amount
    store.events[`${openingId}:rub`] = {
      eventId: `${openingId}:rub`,
      userId: user.telegramId,
      amount: reward.amount,
      type: 'CASE_RUB_WIN',
      referenceId: openingId,
      createdAt: utcNow(),
    }
  }
}

function createOpening(store, user, caseConfig, openingId, pricePaid) {
  const reward = rollReward(caseConfig.rewards)
  if (!reward) {
    return null
  }

  const opening = {
    openingId,
    caseId: caseConfig.id,
    rewardId: reward.id,
    rewardAmount: reward.amount,
    rewardCurrency: reward.currency,
    pricePaid,
    prize: publicPrize(reward),
    createdAt: utcNow(),
  }

  if (String(reward.currency || '').toUpperCase() === 'COINS' && Number(reward.amount) > 0) {
    opening.coinClaimStatus = 'AVAILABLE'
  }

  saveOpeningRecord(store, user, opening)
  grantReward(store, user, reward, openingId)
  return opening
}

function syncOpeningCoinClaimStatus(store, user, openingId, status) {
  const list = ensureArray(user.caseOpenings)
  const inUser = list.find((item) => item.openingId === openingId)
  if (inUser) {
    inUser.coinClaimStatus = status
  }
  store.caseOpenings = store.caseOpenings || {}
  if (store.caseOpenings[openingId]) {
    store.caseOpenings[openingId].coinClaimStatus = status
  } else if (inUser) {
    store.caseOpenings[openingId] = {
      id: openingId,
      userId: user.telegramId,
      caseId: inUser.caseId,
      rewardId: inUser.rewardId,
      rewardAmount: inUser.rewardAmount,
      rewardCurrency: inUser.rewardCurrency,
      pricePaid: inUser.pricePaid,
      createdAt: inUser.createdAt,
      coinClaimStatus: status,
    }
  }
}

export function caseCoinPrizeEventId(openingId) {
  return `${openingId}:prize`
}

/**
 * Credit COINS from a case opening inventory item onto the user balance.
 * Idempotent via `${openingId}:prize`.
 */
export function claimCaseCoinsOnStore(store, userId, itemId) {
  const uid = Number(userId)
  const openingId = String(itemId || '').trim()
  const user = store.users[String(uid)]

  if (!Number.isInteger(uid) || uid <= 0 || !user) {
    return {
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Не удалось определить пользователя.',
    }
  }

  if (!openingId) {
    return {
      success: false,
      code: 'ITEM_NOT_FOUND',
      message: 'Предмет недоступен.',
    }
  }

  user.caseOpenings = ensureArray(user.caseOpenings)
  const opening =
    user.caseOpenings.find((item) => item.openingId === openingId) ||
    (store.caseOpenings?.[openingId] &&
    Number(store.caseOpenings[openingId].userId) === uid
      ? store.caseOpenings[openingId]
      : null)

  if (!opening) {
    return {
      success: false,
      code: 'ITEM_NOT_FOUND',
      message: 'Предмет недоступен.',
    }
  }

  const ownerId = Number(opening.userId != null ? opening.userId : uid)
  if (ownerId !== uid) {
    return {
      success: false,
      code: 'ITEM_NOT_FOUND',
      message: 'Предмет недоступен.',
    }
  }

  const currency = String(opening.rewardCurrency || opening.prize?.currency || '').toUpperCase()
  if (currency !== 'COINS') {
    return {
      success: false,
      code: 'NOT_CLAIMABLE',
      message: 'Этот предмет нельзя получить на баланс.',
    }
  }

  const amount = Math.floor(Number(opening.rewardAmount ?? opening.prize?.amount ?? 0))
  if (!Number.isFinite(amount) || amount < 1) {
    return {
      success: false,
      code: 'INVALID_AMOUNT',
      message: 'Некорректная сумма награды.',
    }
  }

  const eventId = caseCoinPrizeEventId(openingId)
  const alreadyClaimed =
    String(opening.coinClaimStatus || '').toUpperCase() === 'CLAIMED' || hasEvent(store, eventId)

  if (alreadyClaimed) {
    syncOpeningCoinClaimStatus(store, user, openingId, 'CLAIMED')
    return {
      success: true,
      alreadyClaimed: true,
      message: 'Монеты уже начислены на баланс.',
      reward: amount,
      opening: publicOpening({
        ...opening,
        openingId,
        coinClaimStatus: 'CLAIMED',
      }),
    }
  }

  const prizeName = opening.prize?.name || `${amount} монет`
  const grant = addCoins(store, user, amount, TX_TYPE.CASE_REWARD, eventId, {
    referenceId: openingId,
    description: `Выигрыш из кейса: ${prizeName}`,
  })

  if (!grant.granted && grant.reason !== 'already_granted') {
    return {
      success: false,
      code: 'GRANT_FAILED',
      message: grant.message || 'Не удалось начислить монеты.',
    }
  }

  syncOpeningCoinClaimStatus(store, user, openingId, 'CLAIMED')

  return {
    success: true,
    alreadyClaimed: Boolean(grant.reason === 'already_granted'),
    message: 'Монеты зачислены на баланс.',
    reward: amount,
    opening: publicOpening({
      ...opening,
      openingId,
      coinClaimStatus: 'CLAIMED',
    }),
  }
}

export function claimCaseCoins(userId, itemId) {
  return withStore((store) => claimCaseCoinsOnStore(store, userId, itemId))
}

function existingOpening(store, user, openingId) {
  return (
    ensureArray(user.caseOpenings).find((item) => item.openingId === openingId) ||
    store.caseOpenings?.[openingId] ||
    null
  )
}

function requestEventKey(userId, requestId) {
  return `case:request:${userId}:${requestId}`
}

function openReferralCase(store, user, caseConfig, requestId) {
  const idempotencyKey = String(requestId || '').trim()

  if (!idempotencyKey) {
    return {
      success: false,
      code: 'MISSING_REQUEST_ID',
      message: 'Нужен requestId для этой операции.',
    }
  }

  const existingEvent = store.events[requestEventKey(user.telegramId, idempotencyKey)]
  if (existingEvent?.opening && Number(existingEvent.userId) === Number(user.telegramId)) {
    return {
      success: true,
      message: 'Кейс уже открыт.',
      opening: publicOpening(existingEvent.opening),
    }
  }

  if (!isDropTableValid(caseConfig.rewards)) {
    return invalidDropTableResult(caseConfig)
  }

  const activeCount = activeReferralCountForUser(store, user)
  const caseStats = getReferralCaseStats(activeCount, user.openedReferralCases || 0)
  user.openedReferralCases = user.openedReferralCases || 0

  if (caseStats.availableReferralCases <= 0) {
    return {
      success: false,
      code: 'NOT_AVAILABLE',
      message: 'Реферальный кейс пока недоступен. Пригласи ещё друзей.',
    }
  }

  const nextIndex = user.openedReferralCases + 1
  const stableOpeningId = `case:referral:${user.telegramId}:${nextIndex}`
  const recovered = existingOpening(store, user, stableOpeningId)

  if (hasEvent(store, stableOpeningId) || recovered) {
    const opening = recovered || store.events[stableOpeningId]?.opening
    return {
      success: true,
      message: 'Кейс уже открыт.',
      opening: opening ? publicOpening(opening) : undefined,
    }
  }

  // Reserve the slot atomically before rolling rewards.
  const reserveEventId = `${stableOpeningId}:reserve`
  if (hasEvent(store, reserveEventId)) {
    const opening = existingOpening(store, user, stableOpeningId)
    return {
      success: true,
      message: 'Кейс уже открыт.',
      opening: opening ? publicOpening(opening) : undefined,
    }
  }

  store.events[reserveEventId] = {
    eventId: reserveEventId,
    userId: user.telegramId,
    amount: 0,
    reason: 'REFERRAL_CASE_RESERVE',
    createdAt: new Date().toISOString(),
  }

  const opening = createOpening(store, user, caseConfig, stableOpeningId, 0)

  if (!opening) {
    delete store.events[reserveEventId]
    return invalidDropTableResult(caseConfig)
  }

  user.openedReferralCases = nextIndex
  recordReferralCaseGrant(store, user, stableOpeningId, opening.createdAt)

  store.events[stableOpeningId] = {
    eventId: stableOpeningId,
    userId: user.telegramId,
    amount: 0,
    reason: 'CASE_OPEN',
    opening,
    createdAt: opening.createdAt,
  }

  store.events[requestEventKey(user.telegramId, idempotencyKey)] = {
    eventId: requestEventKey(user.telegramId, idempotencyKey),
    userId: user.telegramId,
    amount: 0,
    reason: 'CASE_OPEN',
    opening,
    createdAt: opening.createdAt,
  }

  return {
    success: true,
    message: 'Кейс открыт.',
    opening: publicOpening(opening),
  }
}

function openPurchasedCase(store, user, caseConfig, requestId) {
  const idempotencyKey = String(requestId || '').trim()

  if (!idempotencyKey) {
    return {
      success: false,
      code: 'MISSING_REQUEST_ID',
      message: 'Нужен requestId для этой операции.',
    }
  }

  const existingEvent = store.events[requestEventKey(user.telegramId, idempotencyKey)]
  if (existingEvent?.opening && Number(existingEvent.userId) === Number(user.telegramId)) {
    return {
      success: true,
      message: 'Кейс уже открыт.',
      opening: publicOpening(existingEvent.opening),
    }
  }

  if (!isDropTableValid(caseConfig.rewards)) {
    return invalidDropTableResult(caseConfig)
  }

  // Price always from server config.
  const price = caseConfig.price
  const balance = Number(user.balance || 0)
  if (balance < price) {
    return {
      success: false,
      code: 'INSUFFICIENT_FUNDS',
      message: `Для открытия нужно ${price.toLocaleString('ru-RU')} 🪙, а у тебя только ${balance.toLocaleString('ru-RU')} 🪙.`,
    }
  }

  const openingId = `case:purchase:${user.telegramId}:${idempotencyKey}`
  const recovered = existingOpening(store, user, openingId)

  if (recovered) {
    return {
      success: true,
      message: 'Кейс уже открыт.',
      opening: publicOpening(recovered),
    }
  }

  const spend = spendCoins(store, user, price, TX_TYPE.CASE_PURCHASE, `${openingId}:spend`, {
    referenceId: openingId,
    description: `Открытие кейса: ${caseConfig.name}`,
  })

  if (!spend.spent) {
    const afterSpend = existingOpening(store, user, openingId)
    if (afterSpend) {
      return {
        success: true,
        message: 'Кейс уже открыт.',
        opening: publicOpening(afterSpend),
      }
    }

    return {
      success: false,
      code: spend.reason === 'insufficient' ? 'INSUFFICIENT_FUNDS' : 'ALREADY_PROCESSED',
      message:
        spend.reason === 'insufficient'
          ? `Для открытия нужно ${price.toLocaleString('ru-RU')} 🪙, а у тебя только ${Number(user.balance || 0).toLocaleString('ru-RU')} 🪙.`
          : 'Открытие уже обрабатывается.',
    }
  }

  const opening = createOpening(store, user, caseConfig, openingId, price)

  if (!opening) {
    return invalidDropTableResult(caseConfig)
  }

  store.events[requestEventKey(user.telegramId, idempotencyKey)] = {
    eventId: requestEventKey(user.telegramId, idempotencyKey),
    userId: user.telegramId,
    amount: 0,
    reason: 'CASE_OPEN',
    opening,
    createdAt: opening.createdAt,
  }

  return {
    success: true,
    message: 'Кейс открыт.',
    opening: publicOpening(opening),
  }
}

export function openCase(userId, caseId, requestId) {
  return withStore((store) => {
    migrateAllReferrals(store)
    const user = store.users[String(userId)]
    const caseConfig = findCase(caseId)

    if (!user) {
      return { success: false, message: 'Пользователь не найден.' }
    }

    // Heal corrupt array fields before economy mutations (objects used to pass `|| []`).
    user.caseOpenings = ensureArray(user.caseOpenings)
    user.earnedRewards = ensureArray(user.earnedRewards)
    user.invitedUsers = ensureArray(user.invitedUsers)
    user.completedTasks = ensureArray(user.completedTasks)
    user.startedPartnerTasks = ensureArray(user.startedPartnerTasks)
    user.orderIds = ensureArray(user.orderIds)

    if (!caseConfig) {
      return { success: false, message: 'Кейс не найден.' }
    }

    if (caseConfig.type === 'referral') {
      return openReferralCase(store, user, caseConfig, requestId)
    }

    return openPurchasedCase(store, user, caseConfig, requestId)
  })
}
