import {
  KICK_CONNECT_TASK_ID,
  KICK_FOLLOW_TASK_ID,
  KICK_NICKNAME_TASK_ID,
} from './constants.mjs'
import { TX_TYPE } from './wallet.mjs'

const KICK_TASK_IDS = new Set([
  KICK_CONNECT_TASK_ID,
  KICK_FOLLOW_TASK_ID,
  KICK_NICKNAME_TASK_ID,
])

function isKickLedgerKey(key) {
  const id = String(key || '')
  return (
    id.startsWith(`task:${KICK_CONNECT_TASK_ID}:`) ||
    id.startsWith(`task:${KICK_FOLLOW_TASK_ID}:`) ||
    id.startsWith(`task:${KICK_NICKNAME_TASK_ID}:`) ||
    id.startsWith('task:kick-follow:') ||
    id.startsWith(`${TX_TYPE.TASK_REWARD}:${KICK_CONNECT_TASK_ID}:`) ||
    id.startsWith(`${TX_TYPE.TASK_REWARD}:${KICK_FOLLOW_TASK_ID}:`) ||
    id.startsWith(`${TX_TYPE.TASK_REWARD}:${KICK_NICKNAME_TASK_ID}:`)
  )
}

function clearKickFieldsOnUser(user) {
  if (!user || typeof user !== 'object') {
    return false
  }
  const hadKick =
    Boolean(user.kickUserId) ||
    Boolean(user.kickVerified) ||
    Boolean(user.kickUsername) ||
    Boolean(user.kickLinkedAt)

  user.kickVerified = false
  user.kickUserId = null
  user.kickUsername = null
  user.kickDisplayName = null
  user.kickAvatarUrl = null
  user.kickLinkedAt = null
  return hadKick
}

function clearKickTasksOnUser(user) {
  if (!user || typeof user !== 'object') {
    return 0
  }
  const before = Array.isArray(user.completedTasks) ? user.completedTasks : []
  const after = before.filter((taskId) => !KICK_TASK_IDS.has(String(taskId)))
  let removed = 0
  if (after.length !== before.length) {
    removed = before.length - after.length
    user.completedTasks = after
  }
  if (Array.isArray(user.earnedRewards)) {
    user.earnedRewards = user.earnedRewards.filter((eventId) => !isKickLedgerKey(eventId))
  }
  return removed
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
}

/**
 * Find a durable user by Telegram id or by Telegram / Kick username (@optional).
 */
export function findUserForKickUnlink(store, { telegramId = null, username = null } = {}) {
  const tid = Number(telegramId)
  if (Number.isInteger(tid) && tid > 0) {
    return store.users?.[String(tid)] || null
  }

  const needle = normalizeUsername(username)
  if (!needle) {
    return null
  }

  for (const user of Object.values(store.users || {})) {
    if (!user || typeof user !== 'object') {
      continue
    }
    if (normalizeUsername(user.username) === needle) {
      return user
    }
    if (normalizeUsername(user.kickUsername) === needle) {
      return user
    }
  }
  return null
}

/**
 * Unlink Kick for one Telegram user. Does not reverse already granted coins.
 * Clears Kick task markers so Kick tasks can be completed again after re-link.
 */
export function unlinkKickForUserOnStore(store, { telegramId = null, username = null } = {}) {
  store.kickAccounts = store.kickAccounts || {}
  store.kickByTelegram = store.kickByTelegram || {}
  store.kickFollows = store.kickFollows || {}
  store.kickStreamStreaks = store.kickStreamStreaks || {}
  store.events = store.events || {}
  store.coinTransactions = store.coinTransactions || {}

  const user = findUserForKickUnlink(store, { telegramId, username })
  if (!user) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Пользователь не найден.',
      unlinked: false,
    }
  }

  const tgKey = String(user.telegramId)
  const kickId =
    (store.kickByTelegram[tgKey] && String(store.kickByTelegram[tgKey])) ||
    (user.kickUserId ? String(user.kickUserId) : '') ||
    ''

  const hadKickFields = clearKickFieldsOnUser(user)
  const tasksUnclaimed = clearKickTasksOnUser(user)

  let accountRemoved = false
  let followRemoved = false
  let streakRemoved = false
  let eventsRemoved = 0
  let txRemoved = 0

  if (store.kickByTelegram[tgKey]) {
    delete store.kickByTelegram[tgKey]
  }

  if (kickId && store.kickAccounts[kickId]) {
    const account = store.kickAccounts[kickId]
    if (!account.telegramUserId || Number(account.telegramUserId) === Number(user.telegramId)) {
      delete store.kickAccounts[kickId]
      accountRemoved = true
    }
  }

  if (kickId && store.kickFollows[kickId]) {
    delete store.kickFollows[kickId]
    followRemoved = true
  }

  if (store.kickStreamStreaks[tgKey]) {
    delete store.kickStreamStreaks[tgKey]
    streakRemoved = true
  }

  for (const key of Object.keys(store.events)) {
    if (!isKickLedgerKey(key)) {
      continue
    }
    if (key.includes(String(user.telegramId))) {
      delete store.events[key]
      eventsRemoved += 1
    }
  }

  for (const key of Object.keys(store.coinTransactions)) {
    const row = store.coinTransactions[key]
    if (Number(row?.telegramId) === Number(user.telegramId) && isKickLedgerKey(key)) {
      delete store.coinTransactions[key]
      txRemoved += 1
    }
  }

  const unlinked = hadKickFields || Boolean(kickId) || accountRemoved || tasksUnclaimed > 0

  return {
    ok: true,
    unlinked,
    telegramId: Number(user.telegramId),
    username: user.username || null,
    previousKickUserId: kickId || null,
    accountRemoved,
    followRemoved,
    streakRemoved,
    tasksUnclaimed,
    eventsRemoved,
    txRemoved,
  }
}

/**
 * Wipe every Kick binding / OAuth state / follow evidence so accounts can be linked again.
 * Does not reverse already granted coin balances (avoids negative balances if spent).
 * Removes Kick task completion markers + ledger keys so Kick tasks can be completed again.
 */
export function resetAllKickBindingsOnStore(store) {
  const previousAccounts = Object.keys(store.kickAccounts || {}).length
  const previousLinks = Object.keys(store.kickByTelegram || {}).length
  const previousFollows = Object.keys(store.kickFollows || {}).length

  let usersCleared = 0
  let tasksUnclaimed = 0
  let eventsRemoved = 0
  let txRemoved = 0

  store.kickAccounts = {}
  store.kickByTelegram = {}
  store.kickOAuthStates = {}
  store.kickFollows = {}
  store.kickStreamStreaks = {}
  store.kickWebhookEvents = {}
  store.kickLivestreamState = null

  for (const user of Object.values(store.users || {})) {
    if (!user || typeof user !== 'object') {
      continue
    }

    const hadKick = clearKickFieldsOnUser(user)
    const removedTasks = clearKickTasksOnUser(user)
    tasksUnclaimed += removedTasks

    if (hadKick || removedTasks > 0) {
      usersCleared += 1
    }
  }

  for (const key of Object.keys(store.events || {})) {
    if (isKickLedgerKey(key)) {
      delete store.events[key]
      eventsRemoved += 1
    }
  }

  for (const key of Object.keys(store.coinTransactions || {})) {
    if (isKickLedgerKey(key)) {
      delete store.coinTransactions[key]
      txRemoved += 1
    }
  }

  return {
    ok: true,
    previousAccounts,
    previousLinks,
    previousFollows,
    usersCleared,
    tasksUnclaimed,
    eventsRemoved,
    txRemoved,
  }
}
