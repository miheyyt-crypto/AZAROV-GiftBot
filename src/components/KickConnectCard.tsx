import { useEffect, useState } from 'react'

import kickLogo from '@/assets/partners/kick-logo.png'
import { useNotifications } from '@/components/NotificationProvider'
import { applyAccountSnapshot, getCurrentAccount } from '@/lib/account'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import {
  applyKickConnectionFromAccount,
  consumeKickReturnQuery,
  fetchKickConnectionRemote,
  getKickConnection,
  initiateKickOAuth,
} from '@/lib/kick'
import type { KickConnection } from '@/types'

export function KickConnectCard() {
  const { showNotification } = useNotifications()
  const [connection, setConnection] = useState<KickConnection>(() => {
    const account = getCurrentAccount()
    if (account.kickConnected || account.kickUserId) {
      return applyKickConnectionFromAccount(account)
    }
    return getKickConnection()
  })
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

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
      } else {
        showNotification({
          type: 'error',
          title: 'Kick',
          message: returned.message || 'Не удалось привязать Kick.',
        })
        setMessage(returned.message || 'Не удалось привязать Kick.')
      }
    }

    void fetchKickConnectionRemote().then((next) => {
      if (!cancelled) {
        setConnection(next)
        const account = getCurrentAccount()
        if (next.connected) {
          applyAccountSnapshot({
            ...account,
            kickConnected: true,
            kickUsername: next.username || account.kickUsername,
            kickUserId: next.userId || account.kickUserId,
            kickAvatarUrl: next.avatarUrl || account.kickAvatarUrl,
          })
          hydrateBalanceFromAccount()
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [showNotification])

  async function handleConnect() {
    if (connection.connected || isLoading) {
      return
    }

    setMessage(null)
    setIsLoading(true)

    try {
      const result = await initiateKickOAuth()
      setConnection(getKickConnection())

      if (!result.success && result.message) {
        setMessage(result.message)
        showNotification({
          type: result.code === 'already_connected' ? 'info' : 'warning',
          title: 'Kick',
          message: result.message,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-[20px] border border-kick/35 bg-gradient-to-r from-kick-dark via-[#102010] to-bg-elevated/80 p-3.5 shadow-[0_0_24px_rgb(83_204_24/14%)] backdrop-blur-md">
        <div
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-kick p-2"
          aria-hidden
        >
          {connection.connected && connection.avatarUrl ? (
            <img
              src={connection.avatarUrl}
              alt=""
              className="size-full rounded-lg object-cover"
            />
          ) : (
            <img src={kickLogo} alt="" className="size-full object-contain" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-white">Kick</p>
          <p className="truncate text-sm text-muted">
            {connection.connected && connection.username
              ? `@${connection.username}`
              : 'Без него закрыта часть функций'}
          </p>
        </div>

        {!connection.connected && (
          <button
            type="button"
            onClick={() => {
              void handleConnect()
            }}
            disabled={isLoading}
            className="shrink-0 rounded-xl bg-kick px-4 py-2 text-sm font-semibold text-black transition hover:bg-kick-light disabled:opacity-60"
          >
            {isLoading ? '...' : 'Привязать'}
          </button>
        )}

        {connection.connected && (
          <span className="shrink-0 rounded-xl border border-kick/40 bg-kick/10 px-3 py-1.5 text-xs font-medium text-kick-light">
            Подключено ✓
          </span>
        )}
      </div>

      {message && (
        <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  )
}
