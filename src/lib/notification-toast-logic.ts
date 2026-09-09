/**
 * Pure helpers for server-notification toasts (polling UX).
 * Display-only — never creates notifications or touches the ledger.
 */

import type { UserNotification } from '@/types/user-notification'

export const SERVER_TOAST_POLL_MS = 12_000
export const SERVER_TOAST_DURATION_MS = 5_000
export const SERVER_TOAST_MAX_QUEUE = 5

export const TOASTABLE_NOTIFICATION_TYPES = [
  'PARTNER_SUBMISSION_APPROVED',
  'PARTNER_SUBMISSION_REJECTED',
  'ORDER_APPROVED',
  'ORDER_REJECTED',
  'COMMUNITY_ACCESS_APPROVED',
  'COMMUNITY_ACCESS_REJECTED',
  'LEVEL_UP',
  'SYSTEM',
] as const

const TOASTABLE = new Set<string>(TOASTABLE_NOTIFICATION_TYPES)

export type ServerToastTone = 'success' | 'error' | 'info'

export interface ServerToastCopy {
  tone: ServerToastTone
  title: string
  message?: string
}

export interface ServerToastSession {
  seeded: boolean
  knownIds: Set<string>
}

export function isToastableNotificationType(type: unknown): boolean {
  return TOASTABLE.has(String(type || ''))
}

export function isToastableNotification(
  notification: Pick<UserNotification, 'type'> | null | undefined,
): boolean {
  return Boolean(notification && isToastableNotificationType(notification.type))
}

export function buildServerToastCopy(
  notification: Pick<UserNotification, 'type' | 'title' | 'message' | 'metadata'> | null | undefined,
): ServerToastCopy | null {
  const type = String(notification?.type || '')
  const meta =
    notification?.metadata && typeof notification.metadata === 'object'
      ? notification.metadata
      : {}
  const reward =
    typeof meta.reward === 'number' && Number.isFinite(meta.reward) && meta.reward > 0
      ? Math.floor(meta.reward)
      : null

  switch (type) {
    case 'PARTNER_SUBMISSION_APPROVED':
      return {
        tone: 'success',
        title: 'Задание одобрено',
        message: reward != null ? `+${reward.toLocaleString('ru-RU')} монет начислено` : undefined,
      }
    case 'PARTNER_SUBMISSION_REJECTED':
      return {
        tone: 'error',
        title: 'Задание отклонено',
        message: 'Нажмите, чтобы узнать причину',
      }
    case 'COMMUNITY_ACCESS_APPROVED':
      return {
        tone: 'success',
        title: 'Доступ одобрен',
        message: 'Заявка в закрытое сообщество подтверждена',
      }
    case 'COMMUNITY_ACCESS_REJECTED':
      return {
        tone: 'error',
        title: 'Заявка отклонена',
        message: 'Нажмите, чтобы узнать причину',
      }
    case 'ORDER_APPROVED':
      return {
        tone: 'success',
        title: 'Заказ выполнен',
        message:
          typeof meta.productName === 'string' && meta.productName.trim()
            ? meta.productName.trim()
            : undefined,
      }
    case 'ORDER_REJECTED':
      return {
        tone: 'error',
        title: 'Заказ отклонён',
        message: 'Нажмите, чтобы узнать причину',
      }
    case 'LEVEL_UP': {
      const total =
        typeof meta.totalAmount === 'number' && Number.isFinite(meta.totalAmount)
          ? Math.floor(meta.totalAmount)
          : reward
      return {
        tone: 'success',
        title: String(notification?.title || 'Новый уровень!').slice(0, 80),
        message:
          total != null
            ? `+${total.toLocaleString('ru-RU')} монет`
            : String(notification?.message || '')
                .split('\n')[0]
                .slice(0, 120) || undefined,
      }
    }
    case 'SYSTEM':
      return {
        tone: 'info',
        title: String(notification?.title || 'Уведомление').slice(0, 80),
        message:
          String(notification?.message || '')
            .split('\n')[0]
            .slice(0, 120) || undefined,
      }
    default:
      return null
  }
}

export function createServerToastSession(): ServerToastSession {
  return {
    seeded: false,
    knownIds: new Set(),
  }
}

export function ingestPolledNotifications(
  session: ServerToastSession,
  notifications: UserNotification[] | null | undefined,
): { newlyQueued: UserNotification[]; seededNow: boolean } {
  const list = Array.isArray(notifications) ? notifications : []
  const newlyQueued: UserNotification[] = []

  if (!session.seeded) {
    for (const row of list) {
      if (row?.id) {
        session.knownIds.add(String(row.id))
      }
    }
    session.seeded = true
    return { newlyQueued, seededNow: true }
  }

  const fresh: UserNotification[] = []
  for (const row of list) {
    const id = row?.id ? String(row.id) : ''
    if (!id || session.knownIds.has(id)) {
      continue
    }
    session.knownIds.add(id)
    if (isToastableNotification(row)) {
      fresh.push(row)
    }
  }

  for (const row of fresh.reverse()) {
    newlyQueued.push(row)
  }

  return { newlyQueued, seededNow: false }
}

export function appendToastQueue<T>(
  queue: T[] | null | undefined,
  incoming: T[] | null | undefined,
  maxQueue = SERVER_TOAST_MAX_QUEUE,
): T[] {
  const base = Array.isArray(queue) ? [...queue] : []
  const add = Array.isArray(incoming) ? incoming : []
  const next = [...base, ...add]
  if (next.length <= maxQueue) {
    return next
  }
  return next.slice(next.length - maxQueue)
}

export function peekToastQueue<T>(queue: T[] | null | undefined): T | null {
  return Array.isArray(queue) && queue.length > 0 ? queue[0] : null
}

export function shiftToastQueue<T>(
  queue: T[] | null | undefined,
): { next: T | null; remaining: T[] } {
  if (!Array.isArray(queue) || queue.length === 0) {
    return { next: null, remaining: [] }
  }
  const [next, ...remaining] = queue
  return { next, remaining }
}
