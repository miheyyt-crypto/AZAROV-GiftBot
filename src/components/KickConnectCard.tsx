import { useEffect, useState } from 'react'

import kickLogo from '@/assets/partners/kick-logo.png'
import { useNotifications } from '@/components/NotificationProvider'
import { useUserAccount } from '@/hooks/useUserAccount'
import {
  applyKickConnectionFromAccount,
  fetchKickConnectionRemote,
  getKickConnection,
  initiateKickOAuth,
} from '@/lib/kick'
import type { KickConnection } from '@/types'

export function KickConnectCard() {
  const { showNotification } = useNotifications()
  const account = useUserAccount()
  const [connection, setConnection] = useState<KickConnection>(() => {
    if (account.kickConnected || account.kickUserId) {
      return applyKickConnectionFromAccount(account)
    }
    return getKickConnection()
  })
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchKickConnectionRemote().then((next) => {
      if (!cancelled) {
        setConnection(next)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (account.kickConnected || account.kickUserId) {
      setConnection(applyKickConnectionFromAccount(account))
    }
  }, [
    account.kickConnected,
    account.kickUserId,
    account.kickUsername,
    account.kickAvatarUrl,
  ])

  async function handleConnect() {
    if (connection.connected || isLoading) {
      return
    }

    setMessage(null)
    setIsLoading(true)

    try {
      const result = await initiateKickOAuth()
      setConnection(getKickConnection())

      if (result.success) {
        showNotification({
          type: 'info',
          title: 'Kick',
          message: 'Подтверди вход в Kick. После возврата в бота статус обновится сам.',
        })
      } else if (result.message) {
        setMessage(result.message)
        showNotification({
          type: result.code === 'already_connected' ? 'info' : 'warning',
          title: 'Kick',
          message: result.message,
        })
        if (result.code === 'already_connected') {
          const next = await fetchKickConnectionRemote()
          setConnection(next)
        }
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="ui-card flex items-center gap-3 p-3.5">
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
          <p className="text-[15px] font-semibold tracking-tight text-white">Kick</p>
          <p className="truncate text-[13px] text-text-secondary">
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
            className="min-h-10 shrink-0 rounded-xl bg-kick px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
          >
            {isLoading ? '...' : 'Привязать'}
          </button>
        )}

        {connection.connected && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-kick/30 bg-kick/10 px-3 py-1.5 text-xs font-medium text-kick-light">
            <span className="size-1.5 rounded-full bg-kick" aria-hidden />
            Подключено
          </span>
        )}
      </div>

      {message && (
        <p className="ui-card px-4 py-3 text-sm text-muted">{message}</p>
      )}
    </div>
  )
}
