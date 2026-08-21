export type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'reward'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message?: string
  duration?: number
  createdAt: number
}

export interface ShowNotificationInput {
  type: NotificationType
  title: string
  message?: string
  duration?: number
}

export const NOTIFICATION_DEFAULT_DURATION: Record<NotificationType, number> = {
  success: 3000,
  info: 3000,
  warning: 4000,
  error: 5000,
  reward: 5000,
}

export const NOTIFICATION_MAX_STACK = 3
