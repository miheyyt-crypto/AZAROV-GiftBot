import { addCoins, hasEvent, TX_TYPE } from './wallet.mjs'
import {
  REFERRAL_INVITE_TASK_ID,
  REFERRAL_INVITE_TASK_REQUIRED,
  REFERRAL_INVITE_TASK_REWARD,
  TELEGRAM_CHANNEL,
  TELEGRAM_SUBSCRIBE_REWARD,
  TELEGRAM_SUBSCRIBE_TASK_ID,
} from './constants.mjs'
import { withStore } from './store.mjs'
import { countActiveReferrals } from './users.mjs'

const ACTIVE_MEMBER_STATUSES = new Set(['member', 'administrator', 'creator'])

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

async function getChatMember(userId) {
  const botToken = process.env.BOT_TOKEN || ''
  const channel = process.env.TELEGRAM_CHANNEL || TELEGRAM_CHANNEL

  if (!botToken) {
    throw new Error('bot_not_configured')
  }

  const url = new URL(`https://api.telegram.org/bot${botToken}/getChatMember`)
  url.searchParams.set('chat_id', channel)
  url.searchParams.set('user_id', String(userId))

  const response = await fetch(url)
  const payload = await response.json()

  if (!payload.ok) {
    const description = String(payload.description || '')
    if (description.toLowerCase().includes('user not found')) {
      return { status: 'left' }
    }
    throw new Error('telegram_api_error')
  }

  return payload.result
}

export async function checkTelegramSubscribe(userId, requestId) {
  const idempotencyKey = String(requestId || '').trim()
  if (!idempotencyKey) {
    return {
      success: false,
      code: 'MISSING_REQUEST_ID',
      message: 'Нужен requestId для этой операции.',
    }
  }

  let member

  try {
    member = await getChatMember(userId)
  } catch (error) {
    if (error.message === 'bot_not_configured') {
      return {
        success: false,
        message: 'Проверка подписки пока недоступна. Добавь BOT_TOKEN на сервер.',
      }
    }

    return {
      success: false,
      message: 'Не удалось проверить подписку. Попробуй ещё раз.',
    }
  }

  const status = member?.status || 'left'

  if (!ACTIVE_MEMBER_STATUSES.has(status)) {
    return {
      success: false,
      message: 'Ты ещё не подписан на канал.',
    }
  }

  return withStore((store) => {
    const user = store.users[String(userId)]

    if (!user) {
      return {
        success: false,
        message: 'Пользователь не найден.',
      }
    }

    const requestKey = `task:subscribe:${userId}:${idempotencyKey}`
    if (store.events[requestKey] && Number(store.events[requestKey].userId) === Number(userId)) {
      return {
        success: Boolean(store.events[requestKey].success),
        message: store.events[requestKey].message || 'Награда уже получена.',
      }
    }

    const eventId = `task:${TELEGRAM_SUBSCRIBE_TASK_ID}:${user.telegramId}`

    if (hasEvent(store, eventId) || user.completedTasks.includes(TELEGRAM_SUBSCRIBE_TASK_ID)) {
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

    addCoins(store, user, TELEGRAM_SUBSCRIBE_REWARD, TX_TYPE.TASK_REWARD, eventId, {
      description: 'Награда за задание: подписка Telegram',
    })
    user.completedTasks = [...new Set([...user.completedTasks, TELEGRAM_SUBSCRIBE_TASK_ID])]

    const response = {
      success: true,
      message: 'Подписка подтверждена. Награда 500 монет начислена.',
    }
    store.events[requestKey] = {
      eventId: requestKey,
      userId,
      success: true,
      message: response.message,
      createdAt: new Date().toISOString(),
    }
    return response
  })
}
