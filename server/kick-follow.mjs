import {
  getKickRequiredChannel,
  getKickRequiredChannelUrl,
  KICK_FOLLOW_TASK_ID,
  KICK_FOLLOW_TASK_REWARD,
} from './constants.mjs'
import {
  checkKickUserFollowsChannel,
  refreshKickUserAccessToken,
  resolveKickChannelBySlug,
  verifyKickWebhookSignature,
  getKickWebhookPublicKey,
} from './kick-api.mjs'
import { getKickConnectionForUser, isKickOAuthConfigured } from './kick-oauth.mjs'
import { withStore, withStoreRead } from './store.mjs'
import { addCoins, hasEvent, TX_TYPE } from './wallet.mjs'

function logKickFollow(event, details = {}) {
  console.info(`[kick-follow] ${event}`, details)
}

export function kickFollowEventKey(followerKickUserId, broadcasterUserId) {
  return `${String(followerKickUserId)}:${String(broadcasterUserId)}`
}

export function hasRecordedKickFollow(store, followerKickUserId, broadcasterUserId) {
  store.kickFollows = store.kickFollows || {}
  return Boolean(store.kickFollows[kickFollowEventKey(followerKickUserId, broadcasterUserId)])
}

export function recordKickFollowOnStore(
  store,
  { followerKickUserId, broadcasterUserId, channelSlug, source = 'webhook' },
) {
  store.kickFollows = store.kickFollows || {}
  const key = kickFollowEventKey(followerKickUserId, broadcasterUserId)
  const existing = store.kickFollows[key]
  const now = new Date().toISOString()
  store.kickFollows[key] = {
    followerKickUserId: String(followerKickUserId),
    broadcasterUserId: String(broadcasterUserId),
    channelSlug: String(channelSlug || '').toLowerCase(),
    source,
    followedAt: existing?.followedAt || now,
    updatedAt: now,
  }
  return store.kickFollows[key]
}

function readKickTokenBundle(store, kickUserId) {
  const account = store.kickAccounts?.[String(kickUserId)]
  if (!account?.accessToken) {
    return null
  }
  return {
    accessToken: String(account.accessToken),
    refreshToken: account.refreshToken ? String(account.refreshToken) : '',
    expiresAt: account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : 0,
    scope: String(account.tokenScope || ''),
  }
}

function writeKickTokenBundle(store, kickUserId, tokenBundle) {
  const account = store.kickAccounts?.[String(kickUserId)]
  if (!account || !tokenBundle?.accessToken) {
    return
  }
  const expiresIn = Number(tokenBundle.expiresIn) || 0
  account.accessToken = String(tokenBundle.accessToken)
  if (tokenBundle.refreshToken) {
    account.refreshToken = String(tokenBundle.refreshToken)
  }
  account.tokenScope = String(tokenBundle.scope || account.tokenScope || '')
  account.tokenExpiresAt = new Date(Date.now() + Math.max(expiresIn, 60) * 1000).toISOString()
  account.tokenUpdatedAt = new Date().toISOString()
}

async function getFreshKickUserAccessToken(kickUserId, options = {}) {
  const snapshot = withStoreRead((store) => readKickTokenBundle(store, kickUserId))
  if (!snapshot?.accessToken) {
    const error = new Error('kick_token_missing')
    error.code = 'kick_token_missing'
    throw error
  }

  const stillValid = snapshot.expiresAt > Date.now() + 30_000
  if (stillValid) {
    return snapshot.accessToken
  }

  if (!snapshot.refreshToken) {
    const error = new Error('kick_token_expired')
    error.code = 'kick_token_expired'
    throw error
  }

  const refreshed = await refreshKickUserAccessToken(snapshot.refreshToken, options)
  withStore((store) => {
    writeKickTokenBundle(store, kickUserId, refreshed)
  })
  return refreshed.accessToken
}

function grantKickFollowReward(store, user) {
  const eventId = `task:${KICK_FOLLOW_TASK_ID}:${user.telegramId}`

  if (hasEvent(store, eventId) || user.completedTasks.includes(KICK_FOLLOW_TASK_ID)) {
    user.completedTasks = [...new Set([...user.completedTasks, KICK_FOLLOW_TASK_ID])]
    logKickFollow('duplicate_reward_prevented', {
      userId: user.telegramId,
      taskId: KICK_FOLLOW_TASK_ID,
    })
    return {
      granted: false,
      alreadyCompleted: true,
      reward: 0,
    }
  }

  const grant = addCoins(store, user, KICK_FOLLOW_TASK_REWARD, TX_TYPE.TASK_REWARD, eventId, {
    referenceId: KICK_FOLLOW_TASK_ID,
    description: 'Награда за задание: фоллоу Kick',
  })

  user.completedTasks = [...new Set([...user.completedTasks, KICK_FOLLOW_TASK_ID])]

  if (!grant.granted) {
    return {
      granted: false,
      alreadyCompleted: true,
      reward: 0,
    }
  }

  logKickFollow('reward_granted', {
    userId: user.telegramId,
    taskId: KICK_FOLLOW_TASK_ID,
    amount: KICK_FOLLOW_TASK_REWARD,
  })

  return {
    granted: true,
    alreadyCompleted: false,
    reward: KICK_FOLLOW_TASK_REWARD,
  }
}

export async function checkKickFollow(userId, requestId, options = {}) {
  const idempotencyKey = String(requestId || '').trim()
  if (!idempotencyKey) {
    return {
      success: false,
      completed: false,
      following: false,
      code: 'MISSING_REQUEST_ID',
      message: 'Нужен requestId для этой операции.',
    }
  }

  const channelSlug = getKickRequiredChannel()
  const channelUrl = getKickRequiredChannelUrl()

  logKickFollow('verification_requested', {
    userId: Number(userId),
    taskId: KICK_FOLLOW_TASK_ID,
    channel: channelSlug,
  })

  if (!isKickOAuthConfigured()) {
    return {
      success: false,
      completed: false,
      following: false,
      code: 'KICK_NOT_CONFIGURED',
      message: 'Проверка Kick пока недоступна. Настрой KICK_CLIENT_ID / KICK_CLIENT_SECRET.',
    }
  }

  const precheck = withStore((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return { missing: true }
    }

    const eventId = `task:${KICK_FOLLOW_TASK_ID}:${user.telegramId}`
    if (hasEvent(store, eventId) || user.completedTasks.includes(KICK_FOLLOW_TASK_ID)) {
      user.completedTasks = [...new Set([...user.completedTasks, KICK_FOLLOW_TASK_ID])]
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
      hasToken: Boolean(readKickTokenBundle(store, connection.kickUserId)?.accessToken),
    }
  })

  if (precheck.missing) {
    return {
      success: false,
      completed: false,
      following: false,
      code: 'MISSING_USER',
      message: 'Пользователь не найден.',
    }
  }

  if (precheck.alreadyCompleted) {
    return {
      success: true,
      completed: true,
      following: true,
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
      following: false,
      code: 'KICK_NOT_CONNECTED',
      message: 'Сначала привяжи Kick аккаунт, затем проверь фоллоу.',
    }
  }

  let channel
  try {
    channel = await resolveKickChannelBySlug(channelSlug, options)
  } catch (error) {
    const code = error?.code || 'kick_api_unavailable'
    if (code === 'channel_not_found') {
      return {
        success: false,
        completed: false,
        following: false,
        code: 'CHANNEL_NOT_FOUND',
        message: `Канал Kick @${channelSlug} не найден.`,
      }
    }
    if (code === 'channel_not_configured') {
      return {
        success: false,
        completed: false,
        following: false,
        code: 'CHANNEL_NOT_CONFIGURED',
        message: 'Канал для проверки фоллоу не настроен.',
      }
    }
    return {
      success: false,
      completed: false,
      following: false,
      code: 'KICK_API_ERROR',
      message: 'Не удалось связаться с Kick. Попробуй позже.',
    }
  }

  const kickUserId = String(precheck.connection.kickUserId)

  const webhookHit = withStoreRead((store) =>
    hasRecordedKickFollow(store, kickUserId, channel.broadcasterUserId),
  )

  let following = webhookHit
  let verificationSource = webhookHit ? 'webhook' : null

  if (!following) {
    if (!precheck.hasToken) {
      return {
        success: false,
        completed: false,
        following: false,
        code: 'KICK_TOKEN_MISSING',
        message:
          'Для проверки фоллоу нужно заново привязать Kick (токен не сохранён). Открой профиль → Kick → подключи снова.',
      }
    }

    let accessToken
    try {
      accessToken = await getFreshKickUserAccessToken(kickUserId, options)
    } catch (error) {
      const code = error?.code || 'kick_token_expired'
      return {
        success: false,
        completed: false,
        following: false,
        code: code === 'kick_token_missing' ? 'KICK_TOKEN_MISSING' : 'KICK_TOKEN_EXPIRED',
        message:
          'Сессия Kick истекла. Заново привяжи Kick в профиле, затем нажми «Проверить».',
      }
    }

    try {
      const pull = await checkKickUserFollowsChannel(accessToken, channel, options)
      if (pull.mode === 'unsupported') {
        return {
          success: false,
          completed: false,
          following: false,
          code: 'NOT_FOLLOWING',
          message: `Зафолловь ${channelUrl}, подожди несколько секунд и нажми «Проверить» снова. Если уже подписан — отпишись и подпишись заново.`,
        }
      }
      following = Boolean(pull.following)
      verificationSource = 'pull'
    } catch (error) {
      const code = error?.code || 'kick_api_unavailable'
      if (code === 'kick_token_expired') {
        return {
          success: false,
          completed: false,
          following: false,
          code: 'KICK_TOKEN_EXPIRED',
          message:
            'Сессия Kick истекла. Заново привяжи Kick в профиле, затем нажми «Проверить».',
        }
      }
      return {
        success: false,
        completed: false,
        following: false,
        code: 'KICK_API_ERROR',
        message: 'Не удалось проверить фоллоу через Kick API. Попробуй позже.',
      }
    }
  }

  logKickFollow('membership_check_result', {
    userId: Number(userId),
    kickUserId,
    channel: channel.slug,
    following,
    source: verificationSource,
  })

  if (!following) {
    return {
      success: false,
      completed: false,
      following: false,
      rewarded: false,
      reward: 0,
      code: 'NOT_FOLLOWING',
      message: `Сначала зафолловь канал ${channelUrl} с привязанного Kick аккаунта.`,
    }
  }

  return withStore((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return {
        success: false,
        completed: false,
        following: false,
        code: 'MISSING_USER',
        message: 'Пользователь не найден.',
      }
    }

    recordKickFollowOnStore(store, {
      followerKickUserId: kickUserId,
      broadcasterUserId: channel.broadcasterUserId,
      channelSlug: channel.slug,
      source: verificationSource || 'check',
    })

    const requestKey = `task:kick-follow:${userId}:${idempotencyKey}`
    if (store.events[requestKey] && Number(store.events[requestKey].userId) === Number(userId)) {
      return {
        success: Boolean(store.events[requestKey].success),
        completed: Boolean(store.events[requestKey].completed),
        following: Boolean(store.events[requestKey].following),
        alreadyCompleted: Boolean(store.events[requestKey].alreadyCompleted),
        rewarded: Boolean(store.events[requestKey].rewarded),
        reward: Number(store.events[requestKey].reward || 0),
        message: store.events[requestKey].message || 'Награда уже получена.',
        code: store.events[requestKey].code,
      }
    }

    const grant = grantKickFollowReward(store, user)
    const response = grant.alreadyCompleted && !grant.granted
      ? {
          success: true,
          completed: true,
          following: true,
          alreadyCompleted: true,
          rewarded: false,
          reward: 0,
          code: 'ALREADY_COMPLETED',
          message: 'Задание уже выполнено.',
        }
      : {
          success: true,
          completed: true,
          following: true,
          alreadyCompleted: false,
          rewarded: true,
          reward: grant.reward,
          code: 'COMPLETED',
          message: `Фоллоу подтверждён. Начислено ${KICK_FOLLOW_TASK_REWARD} монет.`,
        }

    store.events[requestKey] = {
      eventId: requestKey,
      userId,
      ...response,
      createdAt: new Date().toISOString(),
    }

    logKickFollow('task_completion_created', {
      userId: user.telegramId,
      taskId: KICK_FOLLOW_TASK_ID,
      rewarded: response.rewarded,
    })

    return response
  })
}

export async function handleKickFollowWebhook(req, options = {}) {
  const rawBody =
    typeof req.rawBody === 'string'
      ? req.rawBody
      : Buffer.isBuffer(req.rawBody)
        ? req.rawBody.toString('utf8')
        : typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body || {})

  const messageId = String(req.headers['kick-event-message-id'] || '').trim()
  const timestamp = String(req.headers['kick-event-message-timestamp'] || '').trim()
  const signature = String(req.headers['kick-event-signature'] || '').trim()
  const eventType = String(req.headers['kick-event-type'] || '').trim()

  let publicKeyPem
  try {
    publicKeyPem = await getKickWebhookPublicKey(options)
  } catch {
    logKickFollow('webhook_public_key_failed', {})
    return { ok: false, status: 503, message: 'public_key_unavailable' }
  }

  const valid = verifyKickWebhookSignature({
    messageId,
    timestamp,
    rawBody,
    signature,
    publicKeyPem,
  })

  if (!valid) {
    logKickFollow('webhook_invalid_signature', { eventType: eventType || null })
    return { ok: false, status: 401, message: 'invalid_signature' }
  }

  if (eventType && eventType !== 'channel.followed') {
    return { ok: true, status: 200, ignored: true }
  }

  let payload
  try {
    payload = typeof req.body === 'object' && req.body && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawBody)
  } catch {
    return { ok: false, status: 400, message: 'invalid_json' }
  }

  const followerKickUserId = String(payload?.follower?.user_id ?? '').trim()
  const broadcasterUserId = String(payload?.broadcaster?.user_id ?? '').trim()
  const channelSlug = String(payload?.broadcaster?.channel_slug || payload?.broadcaster?.username || '')
    .trim()
    .toLowerCase()

  if (!followerKickUserId || !broadcasterUserId) {
    return { ok: false, status: 400, message: 'missing_ids' }
  }

  const required = getKickRequiredChannel()
  if (channelSlug && channelSlug !== required) {
    // Accept by broadcaster id even if slug casing differs; slug mismatch for other channels ignored.
    const requiredChannel = await resolveKickChannelBySlug(required, options).catch(() => null)
    if (requiredChannel && String(requiredChannel.broadcasterUserId) !== broadcasterUserId) {
      return { ok: true, status: 200, ignored: true }
    }
  }

  withStore((store) => {
    recordKickFollowOnStore(store, {
      followerKickUserId,
      broadcasterUserId,
      channelSlug: channelSlug || required,
      source: 'webhook',
    })
  })

  logKickFollow('webhook_follow_recorded', {
    followerKickUserId,
    broadcasterUserId,
    channelSlug: channelSlug || required,
  })

  return { ok: true, status: 200 }
}
