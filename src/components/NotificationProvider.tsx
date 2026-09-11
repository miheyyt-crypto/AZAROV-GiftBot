import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { NotificationToast } from '@/components/NotificationToast'
import { registerNotificationHandler, showNotification as showNotificationApi } from '@/services/api/notifications'
import {
  NOTIFICATION_DEFAULT_DURATION,
  NOTIFICATION_MAX_STACK,
  type AppNotification,
  type ShowNotificationInput,
} from '@/types/notification'

interface NotificationContextValue {
  showNotification: (input: ShowNotificationInput) => void
  dismissNotification: (id: string) => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `n-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AppNotification[]>([])

  const dismissNotification = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const showNotification = useCallback((input: ShowNotificationInput) => {
    const id = createId()
    const duration = input.duration ?? NOTIFICATION_DEFAULT_DURATION[input.type]
    const next: AppNotification = {
      id,
      type: input.type,
      title: input.title,
      message: input.message,
      duration,
      createdAt: Date.now(),
    }

    setItems((prev) => {
      const stacked = [...prev, next]
      return stacked.slice(-NOTIFICATION_MAX_STACK)
    })

    if (duration > 0) {
      window.setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id))
      }, duration)
    }
  }, [])

  useEffect(() => registerNotificationHandler(showNotification), [showNotification])

  const value = useMemo(
    () => ({ showNotification, dismissNotification }),
    [showNotification, dismissNotification],
  )

  const toastLayer =
    typeof document !== 'undefined'
      ? createPortal(
          <div
            className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-height)+0.75rem)] z-[500] mx-auto flex w-full max-w-lg flex-col-reverse gap-2 px-4"
            style={{ paddingBottom: 'var(--safe-area-bottom)' }}
            aria-live="polite"
          >
            {items.map((item) => (
              <NotificationToast
                key={item.id}
                notification={item}
                onDismiss={() => dismissNotification(item.id)}
              />
            ))}
          </div>,
          document.body,
        )
      : null

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {toastLayer}
    </NotificationContext.Provider>
  )
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    return {
      showNotification: showNotificationApi,
      dismissNotification: () => undefined,
    }
  }
  return ctx
}
