import {
  KICK_CONNECT_TASK_ID,
  KICK_FOLLOW_TASK_ID,
} from './constants.mjs'
import { TX_TYPE } from './wallet.mjs'

const KICK_TASK_IDS = new Set([KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID])

function isKickLedgerKey(key) {
  const id = String(key || '')
  return (
    id.startsWith(`task:${KICK_CONNECT_TASK_ID}:`) ||
    id.startsWith(`task:${KICK_FOLLOW_TASK_ID}:`) ||
    id.startsWith('task:kick-follow:') ||
    id.startsWith(`${TX_TYPE.TASK_REWARD}:${KICK_CONNECT_TASK_ID}:`) ||
    id.startsWith(`${TX_TYPE.TASK_REWARD}:${KICK_FOLLOW_TASK_ID}:`)
  )
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

    const before = Array.isArray(user.completedTasks) ? user.completedTasks : []
    const after = before.filter((taskId) => !KICK_TASK_IDS.has(String(taskId)))
    if (after.length !== before.length) {
      tasksUnclaimed += before.length - after.length
      user.completedTasks = after
    }

    if (Array.isArray(user.earnedRewards)) {
      user.earnedRewards = user.earnedRewards.filter((eventId) => !isKickLedgerKey(eventId))
    }

    if (hadKick || before.length !== after.length) {
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
