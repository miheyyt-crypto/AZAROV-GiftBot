import { createAppError } from '@/lib/errors'
import type { AppError } from '@/types/errors'
import type { ShowNotificationInput } from '@/types/notification'

type NotifyFn = (input: ShowNotificationInput) => void

let notifyImpl: NotifyFn | null = null

export function registerNotificationHandler(handler: NotifyFn): () => void {
  notifyImpl = handler
  return () => {
    if (notifyImpl === handler) {
      notifyImpl = null
    }
  }
}

export function showNotification(input: ShowNotificationInput): void {
  if (!notifyImpl) {
    if (import.meta.env.DEV) {
      console.warn('[notifications] Provider is not mounted', input)
    }
    return
  }

  notifyImpl(input)
}

export function notifyAppError(error: AppError): void {
  showNotification({
    type: 'error',
    title: error.title,
    message: error.message,
  })
}

export function notifyFromUnknownError(error: unknown, fallbackTitle?: string): void {
  const appError = createAppError('UNKNOWN_ERROR', error)
  showNotification({
    type: 'error',
    title: fallbackTitle ?? appError.title,
    message: appError.message,
  })
}
