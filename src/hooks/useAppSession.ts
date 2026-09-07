import { useTelegramWebApp } from '@/hooks/useTelegramWebApp'
import { useUserAccount } from '@/hooks/useUserAccount'
import { useNotifications } from '@/components/NotificationProvider'
import {
  consumeKickReturnQuery,
  refreshKickAccountState,
  stopKickConnectionPolling,
} from '@/lib/kick'
import { useEffect } from 'react'

/**
 * Keeps Mini App account state in sync after Kick OAuth.
 * OAuth completes in an external browser; returning to Telegram must refresh /api/kick/me.
 */
export function useAppSession() {
  const telegram = useTelegramWebApp()
  const account = useUserAccount()
  const { showNotification } = useNotifications()

  useEffect(() => {
    let cancelled = false

    const returned = consumeKickReturnQuery()
    if (returned) {
      if (returned.status === 'connected' || returned.status === 'already') {
        showNotification({
          type: 'success',
          title: 'Kick подключён',
          message: returned.message || 'Аккаунт Kick успешно привязан.',
        })
      } else if (returned.status === 'cancelled') {
        showNotification({
          type: 'info',
          title: 'Подключение отменено',
          message: returned.message || 'Подключение отменено.',
        })
      } else if (returned.status) {
        showNotification({
          type: 'error',
          title: 'Kick',
          message: returned.message || 'Не удалось привязать Kick.',
        })
      }
    }

    void refreshKickAccountState()

    function refreshOnResume() {
      if (document.visibilityState === 'visible') {
        void refreshKickAccountState().then((connection) => {
          if (connection.connected) {
            stopKickConnectionPolling()
          }
        })
      }
    }

    document.addEventListener('visibilitychange', refreshOnResume)
    window.addEventListener('focus', refreshOnResume)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refreshOnResume)
      window.removeEventListener('focus', refreshOnResume)
      void cancelled
    }
  }, [showNotification])

  return {
    ...telegram,
    account,
  }
}
