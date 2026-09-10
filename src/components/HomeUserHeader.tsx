import { CoinBalance } from '@/components/BalanceCard'
import { useAuth } from '@/components/AuthGate'
import { UserAvatar } from '@/components/UserAvatar'
import { useUserProfile } from '@/hooks/useUserProfile'
import { getHeaderDisplayName } from '@/lib/user'

export function HomeUserHeader() {
  const { sessionReady } = useAuth()
  const { user, isDemo, displayName } = useUserProfile()
  const displayLabel = getHeaderDisplayName(user)

  return (
    <header className="mb-5 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {sessionReady ? (
          <UserAvatar user={user} size="sm" />
        ) : (
          <div
            className="size-10 shrink-0 animate-pulse rounded-full bg-white/10"
            aria-hidden
          />
        )}
        <div className="min-w-0">
          {sessionReady ? (
            <>
              <p className="truncate text-[15px] font-semibold tracking-tight text-white">
                {displayName}
              </p>
              <p className="truncate text-xs text-muted">
                {isDemo ? 'Демо-режим' : displayLabel}
              </p>
            </>
          ) : (
            <>
              <div className="h-4 w-28 animate-pulse rounded bg-white/12" />
              <div className="mt-1.5 h-3 w-16 animate-pulse rounded bg-white/8" />
            </>
          )}
        </div>
      </div>
      <CoinBalance className="shrink-0" />
    </header>
  )
}
