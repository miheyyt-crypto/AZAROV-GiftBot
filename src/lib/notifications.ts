import { getTelegramInitData } from '@/lib/telegram'
import type {
  NotificationsListResponse,
  UserNotification,
} from '@/types/user-notification'

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const initData = getTelegramInitData()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: 'include',
  })
  const payload = (await response.json().catch(() => null)) as T | null
  if (!payload) {
    throw new Error('bad_response')
  }
  return payload
}

export async function fetchNotifications(
  limit = 50,
): Promise<{ notifications: UserNotification[]; unreadCount: number }> {
  const result = await requestJson<NotificationsListResponse>(
    `/api/notifications?limit=${encodeURIComponent(String(limit))}`,
  )
  if (!result.success) {
    throw new Error(result.message || 'Не удалось загрузить уведомления.')
  }
  return {
    notifications: Array.isArray(result.notifications) ? result.notifications : [],
    unreadCount: Number(result.unreadCount) || 0,
  }
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const result = await requestJson<{ success: boolean; unreadCount?: number; message?: string }>(
    '/api/notifications/unread-count',
  )
  if (!result.success) {
    throw new Error(result.message || 'Не удалось загрузить счётчик уведомлений.')
  }
  return Number(result.unreadCount) || 0
}

export async function markNotificationAsRead(
  notificationId: string,
): Promise<{ notification: UserNotification | null; unreadCount: number }> {
  const result = await requestJson<{
    success: boolean
    notification?: UserNotification | null
    unreadCount?: number
    message?: string
  }>(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  if (!result.success) {
    throw new Error(result.message || 'Не удалось отметить уведомление.')
  }
  return {
    notification: result.notification ?? null,
    unreadCount: Number(result.unreadCount) || 0,
  }
}

export async function markAllNotificationsAsRead(): Promise<{ unreadCount: number }> {
  const result = await requestJson<{
    success: boolean
    unreadCount?: number
    message?: string
  }>('/api/notifications/read-all', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  if (!result.success) {
    throw new Error(result.message || 'Не удалось отметить уведомления.')
  }
  return { unreadCount: Number(result.unreadCount) || 0 }
}
