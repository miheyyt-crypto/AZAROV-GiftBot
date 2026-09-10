import { addCoins, hasEvent, TX_TYPE } from './wallet.mjs'
import {
  LAUNCH_BOT_REWARD,
  LAUNCH_BOT_START_PAYLOAD,
  LAUNCH_BOT_TASK_ID,
  REFERRAL_INVITE_TASK_ID,
  REFERRAL_INVITE_TASK_REQUIRED,
  REFERRAL_INVITE_TASK_REWARD,
  TELEGRAM_CHANNEL,
  TELEGRAM_SUBSCRIBE_REWARD,
  TELEGRAM_SUBSCRIBE_TASK_ID,
} from './constants.mjs'
import { withStore } from './store.mjs'
import { countActiveReferrals } from './users.mjs'

function logTask(event, details = {}) {
  console.info(`[task] ${event}`, details)
}

/**
 * True when Telegram ChatMember represents an active channel subscriber.
 * restricted counts only when is_member === true.
 */
export function isActiveChannelMember(member) {
  const status = String(member?.status || '')
  if (status === 'creator' || status === 'administrator' || status === 'member') {
    return true
  }
  if (status === 'restricted') {
    return member?.is_member === true
  }
  return false
}

/**
 * Classify Telegram getChatMember error descriptions into safe app codes.
 */
export function classifyTelegramMemberError(description = '', errorCode = 0) {
  const text = String(description || '').toLowerCase()

  // Bot/channel access issues first — "bot is not a member" must not match user not_member.
  if (
    text.includes('bot is not a member') ||
    text.includes('bot was kicked') ||
    text.includes('chat_admin_required') ||
    text.includes('not enough rights') ||
    text.includes('have no rights') ||
    text.includes('need administrator') ||
    text.includes('forbidden') ||
    Number(errorCode) === 403
  ) {
    return 'bot_access'
  }

  if (
    text.includes('chat not found') ||
    text.includes('chat_not_found') ||
    text.includes('chat_id is empty')
  ) {
    return 'chat_not_found'
  }

  if (
    text.includes('user not found') ||
    text.includes('user_not_participant') ||
    text.includes('participant_id_invalid') ||
    text.includes('member not found') ||
    text.includes('user is not a member') ||
    text.includes('user is not a participant') ||
    text.includes('not a participant')
  ) {
    return 'not_member'
  }

  return 'telegram_api_error'
}

export async function getChatMember(userId, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const botToken = process.env.BOT_TOKEN || ''
  const channel = String(process.env.TELEGRAM_CHANNEL || TELEGRAM_CHANNEL || '').trim()

  if (!botToken) {
    const error = new Error('bot_not_configured')
    error.code = 'bot_not_configured'
    throw error
  }

  if (!channel) {
    const error = new Error('channel_not_configured')
    error.code = 'channel_not_configured'
    throw error
  }

  const url = new URL(`https://api.telegram.org/bot${botToken}/getChatMember`)
  url.searchParams.set('chat_id', channel)
  url.searchParams.set('user_id', String(userId))

  let response
  try {
    response = await fetchImpl(url)
  } catch (networkError) {
    const error = new Error('telegram_network_error')
    error.code = 'telegram_network_error'
    error.cause = networkError
    throw error
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    const error = new Error('telegram_api_error')
    error.code = 'telegram_api_error'
    throw error
  }

  if (!payload?.ok) {
    const description = String(payload?.description || '')
    const errorCode = Number(payload?.error_code || 0)
    const classified = classifyTelegramMemberError(description, errorCode)

    logTask('telegram_api_error', {
      userId: Number(userId),
      channel,
      errorCode: errorCode || null,
      description: description.slice(0, 180),
      classified,
    })

    if (classified === 'not_member') {
      return { status: 'left' }
    }

    const error = new Error(classified)
    error.code = classified
    error.telegramDescription = description.slice(0, 180)
    error.telegramErrorCode = errorCode || null
    throw error
  }

  return payload.result
}

function grantSubscribeReward(store, user) {
  const eventId = `task:${TELEGRAM_SUBSCRIBE_TASK_ID}:${user.telegramId}`

  if (hasEvent(store, eventId) || user.completedTasks.includes(TELEGRAM_SUBSCRIBE_TASK_ID)) {
    user.completedTasks = [...new Set([...user.completedTasks, TELEGRAM_SUBSCRIBE_TASK_ID])]
    logTask('duplicate_reward_prevented', {
      userId: user.telegramId,
      taskId: TELEGRAM_SUBSCRIBE_TASK_ID,
    })
    return {
      granted: false,
      alreadyCompleted: true,
      reward: 0,
    }
  }

  const grant = addCoins(store, user, TELEGRAM_SUBSCRIBE_REWARD, TX_TYPE.TASK_REWARD, eventId, {
    referenceId: TELEGRAM_SUBSCRIBE_TASK_ID,
    description: 'Награда за задание: подписка Telegram',
  })

  user.completedTasks = [...new Set([...user.completedTasks, TELEGRAM_SUBSCRIBE_TASK_ID])]

  if (!grant.granted) {
    logTask('duplicate_reward_prevented', {
      userId: user.telegramId,
      taskId: TELEGRAM_SUBSCRIBE_TASK_ID,
      reason: grant.reason,
    })
    return {
      granted: false,
      alreadyCompleted: true,
      reward: 0,
    }
  }

  logTask('reward_granted', {
    userId: user.telegramId,
    taskId: TELEGRAM_SUBSCRIBE_TASK_ID,
    amount: TELEGRAM_SUBSCRIBE_REWARD,
  })

  return {
    granted: true,
    alreadyCompleted: false,
    reward: TELEGRAM_SUBSCRIBE_REWARD,
  }
}

export async function checkTelegramSubscribe(userId, requestId, options = {}) {
  const idempotencyKey = String(requestId || '').trim()
  if (!idempotencyKey) {
    return {
      success: false,
      code: 'MISSING_REQUEST_ID',
      completed: false,
      message: 'Нужен requestId для этой операции.',
    }
  }

  logTask('verification_requested', {
    userId: Number(userId),
    taskId: TELEGRAM_SUBSCRIBE_TASK_ID,
  })

  // Fast path: already completed — no Telegram call needed.
  const precheck = withStore((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return { missing: true }
    }
    const eventId = `task:${TELEGRAM_SUBSCRIBE_TASK_ID}:${user.telegramId}`
    if (hasEvent(store, eventId) || user.completedTasks.includes(TELEGRAM_SUBSCRIBE_TASK_ID)) {
      user.completedTasks = [...new Set([...user.completedTasks, TELEGRAM_SUBSCRIBE_TASK_ID])]
      logTask('task_already_completed', {
        userId: user.telegramId,
        taskId: TELEGRAM_SUBSCRIBE_TASK_ID,
      })
      return {
        missing: false,
        alreadyCompleted: true,
        balance: user.balance,
      }
    }
    return { missing: false, alreadyCompleted: false }
  })

  if (precheck.missing) {
    return {
      success: false,
      code: 'MISSING_USER',
      completed: false,
      message: 'Пользователь не найден.',
    }
  }

  if (precheck.alreadyCompleted) {
    return {
      success: true,
      completed: true,
      alreadyCompleted: true,
      rewarded: false,
      reward: 0,
      message: 'Задание уже выполнено.',
    }
  }

  let member
  try {
    member = await getChatMember(userId, options)
  } catch (error) {
    const code = error?.code || error?.message || 'telegram_api_error'

    if (code === 'bot_not_configured') {
      return {
        success: false,
        code: 'BOT_NOT_CONFIGURED',
        completed: false,
        message: 'Проверка подписки пока недоступна. Добавь BOT_TOKEN на сервер.',
      }
    }

    if (code === 'channel_not_configured') {
      return {
        success: false,
        code: 'CHANNEL_NOT_CONFIGURED',
        completed: false,
        message: 'Канал для проверки подписки не настроен.',
      }
    }

    if (code === 'bot_access' || code === 'chat_not_found') {
      return {
        success: false,
        code: 'BOT_CHANNEL_ACCESS',
        completed: false,
        message:
          'Не удалось проверить подписку: бот не имеет доступа к каналу. Добавь бота в @azarov222 как администратора.',
      }
    }

    if (code === 'telegram_network_error') {
      return {
        success: false,
        code: 'TELEGRAM_UNAVAILABLE',
        completed: false,
        message: 'Не удалось проверить подписку. Попробуй ещё раз позже.',
      }
    }

    return {
      success: false,
      code: 'TELEGRAM_API_ERROR',
      completed: false,
      message: 'Не удалось проверить подписку. Попробуй ещё раз позже.',
    }
  }

  const subscribed = isActiveChannelMember(member)
  logTask('membership_check_result', {
    userId: Number(userId),
    status: member?.status || null,
    subscribed,
  })

  if (!subscribed) {
    return {
      success: false,
      code: 'NOT_SUBSCRIBED',
      completed: false,
      rewarded: false,
      reward: 0,
      message: 'Сначала подпишись на канал @azarov222.',
    }
  }

  return withStore((store) => {
    const user = store.users[String(userId)]

    if (!user) {
      return {
        success: false,
        code: 'MISSING_USER',
        completed: false,
        message: 'Пользователь не найден.',
      }
    }

    const requestKey = `task:subscribe:${userId}:${idempotencyKey}`
    if (store.events[requestKey] && Number(store.events[requestKey].userId) === Number(userId)) {
      return {
        success: Boolean(store.events[requestKey].success),
        completed: Boolean(store.events[requestKey].completed),
        alreadyCompleted: Boolean(store.events[requestKey].alreadyCompleted),
        rewarded: Boolean(store.events[requestKey].rewarded),
        reward: Number(store.events[requestKey].reward || 0),
        message: store.events[requestKey].message || 'Награда уже получена.',
      }
    }

    const grant = grantSubscribeReward(store, user)

    if (grant.alreadyCompleted && !grant.granted) {
      const response = {
        success: true,
        completed: true,
        alreadyCompleted: true,
        rewarded: false,
        reward: 0,
        message: 'Задание уже выполнено.',
      }
      store.events[requestKey] = {
        eventId: requestKey,
        userId,
        ...response,
        createdAt: new Date().toISOString(),
      }
      return response
    }

    logTask('task_completion_created', {
      userId: user.telegramId,
      taskId: TELEGRAM_SUBSCRIBE_TASK_ID,
    })

    const response = {
      success: true,
      completed: true,
      alreadyCompleted: false,
      rewarded: true,
      reward: grant.reward,
      message: `Подписка подтверждена. Начислено ${TELEGRAM_SUBSCRIBE_REWARD} монет.`,
    }
    store.events[requestKey] = {
      eventId: requestKey,
      userId,
      ...response,
      createdAt: new Date().toISOString(),
    }
    return response
  })
}

export function maybeGrantInviteFriendsTask(store, user) {
  const active = countActiveReferrals(store, user.telegramId)
  user.activeReferrals = active
  if (active < REFERRAL_INVITE_TASK_REQUIRED) {
    return { granted: false, reason: 'not_ready' }
  }

  const eventId = `task:${REFERRAL_INVITE_TASK_ID}:${user.telegramId}`

  if (hasEvent(store, eventId) || user.completedTasks.includes(REFERRAL_INVITE_TASK_ID)) {
    return { granted: false, reason: 'already_granted' }
  }

  addCoins(store, user, REFERRAL_INVITE_TASK_REWARD, TX_TYPE.TASK_REWARD, eventId, {
    referenceId: REFERRAL_INVITE_TASK_ID,
    description: 'Награда за задание: пригласи друзей',
  })
  user.completedTasks = [...new Set([...user.completedTasks, REFERRAL_INVITE_TASK_ID])]

  return { granted: true, reason: 'granted' }
}

export function claimInviteFriendsTask(userId, requestId) {
  return withStore((store) => {
    const user = store.users[String(userId)]

    if (!user) {
      return {
        success: false,
        message: 'Пользователь не найден.',
      }
    }

    const idempotencyKey = String(requestId || '').trim()
    if (!idempotencyKey) {
      return {
        success: false,
        code: 'MISSING_REQUEST_ID',
        message: 'Нужен requestId для этой операции.',
      }
    }

    const requestKey = `task:claim:${userId}:${idempotencyKey}`
    if (store.events[requestKey] && Number(store.events[requestKey].userId) === Number(userId)) {
      return {
        success: Boolean(store.events[requestKey].success),
        message: store.events[requestKey].message || 'Награда уже получена.',
      }
    }

    const active = countActiveReferrals(store, user.telegramId)
    user.activeReferrals = active
    if (active < REFERRAL_INVITE_TASK_REQUIRED) {
      return {
        success: false,
        message: `Приглашено активных друзей: ${active} из ${REFERRAL_INVITE_TASK_REQUIRED}.`,
      }
    }

    const result = maybeGrantInviteFriendsTask(store, user)

    if (result.reason === 'already_granted') {
      const response = {
        success: false,
        message: 'Награда уже получена.',
      }
      store.events[requestKey] = {
        eventId: requestKey,
        userId,
        success: false,
        message: response.message,
        createdAt: new Date().toISOString(),
      }
      return response
    }

    if (result.granted) {
      const response = {
        success: true,
        message: 'Награда 2000 монет начислена.',
      }
      store.events[requestKey] = {
        eventId: requestKey,
        userId,
        success: true,
        message: response.message,
        createdAt: new Date().toISOString(),
      }
      return response
    }

    return {
      success: false,
      message: 'Не удалось начислить награду. Попробуй ещё раз.',
    }
  })
}

export function isLaunchBotStartPayload(raw) {
  const payload = String(raw || '')
    .trim()
    .toLowerCase()
  return payload === LAUNCH_BOT_START_PAYLOAD || payload === `task_${LAUNCH_BOT_START_PAYLOAD}`
}

/**
 * Record verified bot /start for the launch-bot task.
 * Uses ctx.from.id from Telegraf — never trust Mini App claims alone.
 */
export function markBotLaunchStart(telegramUserId) {
  const tid = Number(telegramUserId)
  if (!Number.isInteger(tid) || tid <= 0) {
    return { ok: false }
  }

  return withStore((store) => {
    store.botLaunchStarts = store.botLaunchStarts || {}
    const at = new Date().toISOString()
    store.botLaunchStarts[String(tid)] = { at, telegramId: tid }
    const user = store.users[String(tid)]
    if (user) {
      user.botLaunchVerifiedAt = at
    }
    logTask('bot_launch_verified', { userId: tid })
    return { ok: true, at }
  })
}

function userHasBotLaunchProof(store, user) {
  if (user?.botLaunchVerifiedAt) {
    return true
  }
  const pending = store.botLaunchStarts?.[String(user?.telegramId)]
  return Boolean(pending?.at)
}

function grantLaunchBotReward(store, user) {
  const eventId = `task:${LAUNCH_BOT_TASK_ID}:${user.telegramId}`

  if (hasEvent(store, eventId) || user.completedTasks.includes(LAUNCH_BOT_TASK_ID)) {
    user.completedTasks = [...new Set([...user.completedTasks, LAUNCH_BOT_TASK_ID])]
    logTask('duplicate_reward_prevented', {
      userId: user.telegramId,
      taskId: LAUNCH_BOT_TASK_ID,
    })
    return {
      granted: false,
      alreadyCompleted: true,
      reward: 0,
    }
  }

  const grant = addCoins(store, user, LAUNCH_BOT_REWARD, TX_TYPE.TASK_REWARD, eventId, {
    referenceId: LAUNCH_BOT_TASK_ID,
    description: 'Награда за задание: запуск бота',
  })

  user.completedTasks = [...new Set([...user.completedTasks, LAUNCH_BOT_TASK_ID])]

  if (!grant.granted) {
    logTask('duplicate_reward_prevented', {
      userId: user.telegramId,
      taskId: LAUNCH_BOT_TASK_ID,
      reason: grant.reason,
    })
    return {
      granted: false,
      alreadyCompleted: true,
      reward: 0,
    }
  }

  logTask('reward_granted', {
    userId: user.telegramId,
    taskId: LAUNCH_BOT_TASK_ID,
    amount: LAUNCH_BOT_REWARD,
  })

  return {
    granted: true,
    alreadyCompleted: false,
    reward: LAUNCH_BOT_REWARD,
  }
}

/**
 * Mini App check: award only if bot /start with launch_bot payload was recorded.
 */
export function checkLaunchBot(userId, requestId) {
  const idempotencyKey = String(requestId || '').trim()
  if (!idempotencyKey) {
    return {
      success: false,
      code: 'MISSING_REQUEST_ID',
      completed: false,
      message: 'Нужен requestId для этой операции.',
    }
  }

  logTask('verification_requested', {
    userId: Number(userId),
    taskId: LAUNCH_BOT_TASK_ID,
  })

  return withStore((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return {
        success: false,
        code: 'MISSING_USER',
        completed: false,
        message: 'Пользователь не найден.',
      }
    }

    const requestKey = `task:launch:${userId}:${idempotencyKey}`
    if (store.events[requestKey] && Number(store.events[requestKey].userId) === Number(userId)) {
      return {
        success: Boolean(store.events[requestKey].success),
        completed: Boolean(store.events[requestKey].completed),
        alreadyCompleted: Boolean(store.events[requestKey].alreadyCompleted),
        rewarded: Boolean(store.events[requestKey].rewarded),
        reward: Number(store.events[requestKey].reward || 0),
        message: store.events[requestKey].message || 'Награда уже получена.',
        code: store.events[requestKey].code || undefined,
      }
    }

    const eventId = `task:${LAUNCH_BOT_TASK_ID}:${user.telegramId}`
    if (hasEvent(store, eventId) || user.completedTasks.includes(LAUNCH_BOT_TASK_ID)) {
      user.completedTasks = [...new Set([...user.completedTasks, LAUNCH_BOT_TASK_ID])]
      const response = {
        success: true,
        completed: true,
        alreadyCompleted: true,
        rewarded: false,
        reward: 0,
        message: 'Задание уже выполнено.',
      }
      store.events[requestKey] = {
        eventId: requestKey,
        userId,
        ...response,
        createdAt: new Date().toISOString(),
      }
      return response
    }

    if (!userHasBotLaunchProof(store, user)) {
      return {
        success: false,
        code: 'NOT_STARTED',
        completed: false,
        rewarded: false,
        reward: 0,
        message: 'Сначала запусти бота @AZAROV_GiftBot через кнопку задания и нажми Start.',
      }
    }

    // Copy pending proof onto user if only store map had it.
    const pending = store.botLaunchStarts?.[String(user.telegramId)]
    if (!user.botLaunchVerifiedAt && pending?.at) {
      user.botLaunchVerifiedAt = pending.at
    }

    const grant = grantLaunchBotReward(store, user)
    const response = grant.granted
      ? {
          success: true,
          completed: true,
          alreadyCompleted: false,
          rewarded: true,
          reward: grant.reward,
          message: `Бот запущен. Начислено ${LAUNCH_BOT_REWARD} монет.`,
        }
      : {
          success: true,
          completed: true,
          alreadyCompleted: true,
          rewarded: false,
          reward: 0,
          message: 'Задание уже выполнено.',
        }

    store.events[requestKey] = {
      eventId: requestKey,
      userId,
      ...response,
      createdAt: new Date().toISOString(),
    }
    return response
  })
}
