import {
  getKickNicknameTag,
  KICK_NICKNAME_TASK_ID,
  KICK_NICKNAME_TASK_REWARD,
} from './constants.mjs'
import { getFreshKickUserAccessToken } from './kick-follow.mjs'
import {
  fetchKickAuthorizedUser,
  getKickConnectionForUser,
  isKickOAuthConfigured,
} from './kick-oauth.mjs'
import { withStore } from './store.mjs'
import { addCoins, hasEvent, TX_TYPE } from './wallet.mjs'

function logKickNickname(event, details = {}) {
  console.info(`[kick-nickname] ${event}`, details)
}

export function kickNicknameMatches(profile, tag = getKickNicknameTag()) {
  const needle = String(tag || '')
    .trim()
    .toLowerCase()
  if (!needle) {
    return false
  }
  const username = String(profile?.username || '').toLowerCase()
  const displayName = String(profile?.displayName || '').toLowerCase()
  return username.includes(needle) || displayName.includes(needle)
}

function grantKickNicknameReward(store, user) {
  const eventId = `task:${KICK_NICKNAME_TASK_ID}:${user.telegramId}`

  if (hasEvent(store, eventId) || user.completedTasks.includes(KICK_NICKNAME_TASK_ID)) {
    user.completedTasks = [...new Set([...user.completedTasks, KICK_NICKNAME_TASK_ID])]
    logKickNickname('duplicate_reward_prevented', {
      userId: user.telegramId,
      taskId: KICK_NICKNAME_TASK_ID,
    })
    return {
      granted: false,
      alreadyCompleted: true,
      reward: 0,
    }
  }

  const grant = addCoins(store, user, KICK_NICKNAME_TASK_REWARD, TX_TYPE.TASK_REWARD, eventId, {
    referenceId: KICK_NICKNAME_TASK_ID,
    description: 'Награда за задание: приписка в нике Kick',
  })

  user.completedTasks = [...new Set([...user.completedTasks, KICK_NICKNAME_TASK_ID])]

  if (!grant.granted) {
    return {
      granted: false,
      alreadyCompleted: true,
      reward: 0,
    }
  }

  logKickNickname('reward_granted', {
    userId: user.telegramId,
    taskId: KICK_NICKNAME_TASK_ID,
    amount: KICK_NICKNAME_TASK_REWARD,
  })

  return {
    granted: true,
    alreadyCompleted: false,
    reward: KICK_NICKNAME_TASK_REWARD,
  }
}

/**
 * Verify Kick username/displayName contains required tag via live Kick /users API.
 */
export async function checkKickNickname(userId, requestId, options = {}) {
  const idempotencyKey = String(requestId || '').trim()
  if (!idempotencyKey) {
    return {
      success: false,
      completed: false,
      matched: false,
      code: 'MISSING_REQUEST_ID',
      message: 'Нужен requestId для этой операции.',
    }
  }

  const tag = getKickNicknameTag()

  logKickNickname('verification_requested', {
    userId: Number(userId),
    taskId: KICK_NICKNAME_TASK_ID,
    tag,
  })

  if (!isKickOAuthConfigured()) {
    return {
      success: false,
      completed: false,
      matched: false,
      code: 'KICK_NOT_CONFIGURED',
      message: 'Проверка Kick пока недоступна. Настрой KICK_CLIENT_ID / KICK_CLIENT_SECRET.',
    }
  }

  const precheck = withStore((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return { missing: true }
    }

    const eventId = `task:${KICK_NICKNAME_TASK_ID}:${user.telegramId}`
    if (hasEvent(store, eventId) || user.completedTasks.includes(KICK_NICKNAME_TASK_ID)) {
      user.completedTasks = [...new Set([...user.completedTasks, KICK_NICKNAME_TASK_ID])]
      return {
        missing: false,
        alreadyCompleted: true,
        connection: getKickConnectionForUser(store, userId),
      }
    }

    const connection = getKickConnectionForUser(store, userId)
    return {
      missing: false,
      alreadyCompleted: false,
      connection,
    }
  })

  if (precheck.missing) {
    return {
      success: false,
      completed: false,
      matched: false,
      code: 'MISSING_USER',
      message: 'Пользователь не найден.',
    }
  }

  if (precheck.alreadyCompleted) {
    return {
      success: true,
      completed: true,
      matched: true,
      alreadyCompleted: true,
      rewarded: false,
      reward: 0,
      message: 'Задание уже выполнено.',
    }
  }

  if (!precheck.connection?.connected || !precheck.connection.kickUserId) {
    return {
      success: false,
      completed: false,
      matched: false,
      code: 'KICK_NOT_CONNECTED',
      message: 'Сначала привяжи Kick аккаунт, затем добавь приписку к нику.',
    }
  }

  const kickUserId = String(precheck.connection.kickUserId)
  let accessToken
  try {
    accessToken = await getFreshKickUserAccessToken(kickUserId, options)
  } catch (error) {
    const code = error?.code || 'kick_token_expired'
    return {
      success: false,
      completed: false,
      matched: false,
      code: code === 'kick_token_missing' ? 'KICK_TOKEN_MISSING' : 'KICK_TOKEN_EXPIRED',
      message:
        'Сессия Kick истекла. Заново привяжи Kick в профиле, затем нажми «Проверить».',
    }
  }

  let profile
  try {
    profile = await fetchKickAuthorizedUser(accessToken, options)
  } catch {
    return {
      success: false,
      completed: false,
      matched: false,
      code: 'KICK_API_ERROR',
      message: 'Не удалось получить профиль Kick. Попробуй позже.',
    }
  }

  const matched = kickNicknameMatches(profile, tag)

  return withStore((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return {
        success: false,
        completed: false,
        matched: false,
        code: 'MISSING_USER',
        message: 'Пользователь не найден.',
      }
    }

    // Keep local Kick profile fields in sync with live API.
    if (profile.username) {
      user.kickUsername = profile.username
    }
    if (profile.displayName) {
      user.kickDisplayName = profile.displayName
    }
    const account = store.kickAccounts?.[kickUserId]
    if (account) {
      if (profile.username) account.username = profile.username
      if (profile.displayName) account.displayName = profile.displayName
      account.updatedAt = new Date().toISOString()
    }

    if (!matched) {
      logKickNickname('nickname_mismatch', {
        userId: user.telegramId,
        username: profile.username,
        displayName: profile.displayName,
        tag,
      })
      return {
        success: false,
        completed: false,
        matched: false,
        code: 'NICKNAME_TAG_MISSING',
        message: `Добавь «${tag}» в ник или отображаемое имя на Kick, сохрани изменения и нажми «Проверить».`,
        tag,
        kickUsername: profile.username || null,
        kickDisplayName: profile.displayName || null,
      }
    }

    const grant = grantKickNicknameReward(store, user)
    return {
      success: true,
      completed: true,
      matched: true,
      alreadyCompleted: Boolean(grant.alreadyCompleted),
      rewarded: Boolean(grant.granted),
      reward: grant.reward,
      message: grant.granted
        ? `Приписка «${tag}» подтверждена. Награда начислена.`
        : 'Задание уже выполнено.',
      tag,
      kickUsername: profile.username || null,
      kickDisplayName: profile.displayName || null,
    }
  })
}
