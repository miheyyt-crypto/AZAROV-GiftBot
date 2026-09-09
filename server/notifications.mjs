import crypto from 'node:crypto'

import { hasEvent, utcNow } from './wallet.mjs'
import { withStore, withStoreRead } from './store.mjs'

export const NOTIFICATION_TYPE = {
  PARTNER_SUBMISSION_APPROVED: 'PARTNER_SUBMISSION_APPROVED',
  PARTNER_SUBMISSION_REJECTED: 'PARTNER_SUBMISSION_REJECTED',
  ORDER_APPROVED: 'ORDER_APPROVED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  GIVEAWAY_WON: 'GIVEAWAY_WON',
  GIVEAWAY_COMPLETED: 'GIVEAWAY_COMPLETED',
  SYSTEM: 'SYSTEM',
}

export const MAX_NOTIFICATIONS_PER_USER = 150
export const REJECTION_REASON_MIN_LEN = 3
export const REJECTION_REASON_MAX_LEN = 500

const ALLOWED_TYPES = new Set(Object.values(NOTIFICATION_TYPE))

export function notificationEventId(eventKey) {
  return `notification:${String(eventKey || '').trim()}`
}

export function validateRejectionReason(value) {
  const reason = String(value ?? '').trim()
  if (reason.length < REJECTION_REASON_MIN_LEN) {
    return {
      ok: false,
      code: 'MISSING_REJECTION_REASON',
      message: 'Укажите причину отклонения (минимум 3 символа).',
    }
  }
  if (reason.length > REJECTION_REASON_MAX_LEN) {
    return {
      ok: false,
      code: 'REJECTION_REASON_TOO_LONG',
      message: `Причина отклонения слишком длинная (максимум ${REJECTION_REASON_MAX_LEN} символов).`,
    }
  }
  return { ok: true, value: reason }
}

function ensureNotifications(store) {
  store.notifications = store.notifications || {}
  store.events = store.events || {}
}

function publicNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    read: Boolean(row.read),
    createdAt: row.createdAt,
    relatedEntityType: row.relatedEntityType || null,
    relatedEntityId: row.relatedEntityId || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? { ...row.metadata } : {},
  }
}

function listUserNotificationRows(store, userId) {
  ensureNotifications(store)
  const uid = Number(userId)
  return Object.values(store.notifications)
    .filter((row) => row && Number(row.userId) === uid)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

function pruneUserNotifications(store, userId) {
  const rows = listUserNotificationRows(store, userId)
  if (rows.length <= MAX_NOTIFICATIONS_PER_USER) {
    return
  }

  const overflow = rows.length - MAX_NOTIFICATIONS_PER_USER
  // Prefer pruning oldest read notifications first.
  const removable = [
    ...rows.filter((row) => row.read).reverse(),
    ...rows.filter((row) => !row.read).reverse(),
  ].slice(0, overflow)

  for (const row of removable) {
    delete store.notifications[row.id]
  }
}

/**
 * Idempotent notification create. eventKey must be unique per logical event.
 * Never grants coins — only records a message about a server-side event.
 */
export function createNotificationOnStore(
  store,
  {
    userId,
    type,
    title,
    message,
    eventKey,
    relatedEntityType = null,
    relatedEntityId = null,
    metadata = {},
  },
) {
  ensureNotifications(store)

  const key = String(eventKey || '').trim()
  if (!key) {
    return { created: false, reason: 'missing_event_key', notification: null }
  }

  if (!ALLOWED_TYPES.has(type)) {
    return { created: false, reason: 'invalid_type', notification: null }
  }

  const uid = Number(userId)
  if (!Number.isInteger(uid) || uid <= 0) {
    return { created: false, reason: 'invalid_user', notification: null }
  }

  const eventId = notificationEventId(key)
  if (hasEvent(store, eventId) || store.events[eventId]?.notificationId) {
    const existingId = store.events[eventId]?.notificationId
    const existing = existingId ? store.notifications[existingId] : null
    return {
      created: false,
      reason: 'already_exists',
      notification: existing ? publicNotification(existing) : null,
    }
  }

  const id = crypto.randomUUID()
  const createdAt = utcNow()
  const row = {
    id,
    userId: uid,
    type,
    title: String(title || '').slice(0, 160),
    message: String(message || '').slice(0, 2000),
    read: false,
    createdAt,
    relatedEntityType: relatedEntityType ? String(relatedEntityType).slice(0, 64) : null,
    relatedEntityId: relatedEntityId ? String(relatedEntityId).slice(0, 128) : null,
    metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {},
    eventKey: key,
  }

  store.notifications[id] = row
  store.events[eventId] = {
    eventId,
    notificationId: id,
    userId: uid,
    type,
    createdAt,
  }

  pruneUserNotifications(store, uid)

  return { created: true, reason: 'created', notification: publicNotification(row) }
}

export function countUnreadNotificationsOnStore(store, userId) {
  return listUserNotificationRows(store, userId).filter((row) => !row.read).length
}

export function listNotificationsForUser(userId, { limit = 50 } = {}) {
  return withStoreRead((store) => {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50))
    const rows = listUserNotificationRows(store, userId).slice(0, safeLimit)
    return {
      success: true,
      notifications: rows.map(publicNotification),
      unreadCount: countUnreadNotificationsOnStore(store, userId),
    }
  })
}

export function markNotificationRead(userId, notificationId) {
  return withStore((store) => {
    ensureNotifications(store)
    const row = store.notifications[String(notificationId || '')]
    if (!row || Number(row.userId) !== Number(userId)) {
      return { success: false, code: 'NOT_FOUND', message: 'Уведомление не найдено.' }
    }
    row.read = true
    return {
      success: true,
      notification: publicNotification(row),
      unreadCount: countUnreadNotificationsOnStore(store, userId),
    }
  })
}

export function markAllNotificationsRead(userId) {
  return withStore((store) => {
    ensureNotifications(store)
    for (const row of listUserNotificationRows(store, userId)) {
      row.read = true
    }
    return {
      success: true,
      unreadCount: 0,
    }
  })
}

export function getUnreadNotificationsCount(userId) {
  return withStoreRead((store) => ({
    success: true,
    unreadCount: countUnreadNotificationsOnStore(store, userId),
  }))
}

/** Helpers used by partner/shop moderation after state changes. */
export function notifyPartnerSubmissionApprovedOnStore(store, submission, { reward = 0 } = {}) {
  const partnerName = submission.partnerName || submission.partnerId || 'Партнёр'
  const taskTitle = submission.taskTitle || submission.taskId || 'Задание'
  const coins = Math.max(0, Math.floor(Number(reward || submission.reward) || 0))
  const message =
    coins > 0
      ? `Задание «${taskTitle}» для ${partnerName} одобрено. Начислено ${coins.toLocaleString('ru-RU')} монет.`
      : `Задание «${taskTitle}» для ${partnerName} одобрено.`

  return createNotificationOnStore(store, {
    userId: submission.telegramUserId,
    type: NOTIFICATION_TYPE.PARTNER_SUBMISSION_APPROVED,
    title: 'Задание одобрено',
    message,
    eventKey: `partner_submission:${submission.submissionId}:approved`,
    relatedEntityType: 'partner_submission',
    relatedEntityId: submission.submissionId,
    metadata: {
      partnerId: submission.partnerId || null,
      partnerName,
      taskId: submission.taskId || null,
      taskTitle,
      reward: coins,
    },
  })
}

export function notifyPartnerSubmissionRejectedOnStore(store, submission) {
  const partnerName = submission.partnerName || submission.partnerId || 'Партнёр'
  const taskTitle = submission.taskTitle || submission.taskId || 'Задание'
  const reason = String(submission.rejectionReason || '').trim() || 'Заявка отклонена.'

  return createNotificationOnStore(store, {
    userId: submission.telegramUserId,
    type: NOTIFICATION_TYPE.PARTNER_SUBMISSION_REJECTED,
    title: 'Задание отклонено',
    message: `Задание «${taskTitle}» для ${partnerName} отклонено.\n\nПричина:\n${reason}`,
    eventKey: `partner_submission:${submission.submissionId}:rejected`,
    relatedEntityType: 'partner_submission',
    relatedEntityId: submission.submissionId,
    metadata: {
      partnerId: submission.partnerId || null,
      partnerName,
      taskId: submission.taskId || null,
      taskTitle,
      rejectionReason: reason,
    },
  })
}

export function notifyOrderApprovedOnStore(store, order) {
  const productName = order.productName || order.productId || 'Товар'
  return createNotificationOnStore(store, {
    userId: order.userId,
    type: NOTIFICATION_TYPE.ORDER_APPROVED,
    title: 'Заказ выполнен',
    message: `Заказ «${productName}» одобрен и выполнен.`,
    eventKey: `shop_order:${order.orderId}:approved`,
    relatedEntityType: 'shop_order',
    relatedEntityId: order.orderId,
    metadata: {
      productId: order.productId || null,
      productName,
      orderId: order.orderId,
    },
  })
}

export function notifyOrderRejectedOnStore(store, order) {
  const productName = order.productName || order.productId || 'Товар'
  const reason = String(order.rejectionReason || '').trim() || 'Заказ отклонён.'
  return createNotificationOnStore(store, {
    userId: order.userId,
    type: NOTIFICATION_TYPE.ORDER_REJECTED,
    title: 'Заказ отклонён',
    message: `Заказ «${productName}» отклонён. Монеты возвращены.\n\nПричина:\n${reason}`,
    eventKey: `shop_order:${order.orderId}:rejected`,
    relatedEntityType: 'shop_order',
    relatedEntityId: order.orderId,
    metadata: {
      productId: order.productId || null,
      productName,
      orderId: order.orderId,
      rejectionReason: reason,
    },
  })
}
