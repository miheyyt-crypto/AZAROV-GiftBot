import { CoinBalance } from '@/components/BalanceCard'
import { UserAvatar } from '@/components/UserAvatar'
import { useUserProfile } from '@/hooks/useUserProfile'
import { getHeaderDisplayName } from '@/lib/user'

export function HomeUserHeader() {
  const { user, isDemo, displayName } = useUserProfile()
  const displayLabel = getHeaderDisplayName(user)

  return (
    <header className="mb-5 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar user={user} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-tight text-white">
            {displayName}
          </p>
          <p className="truncate text-xs text-muted">
            {isDemo ? 'Demo mode' : displayLabel}
          </p>
        </div>
      </div>
      <CoinBalance className="shrink-0" />
    </header>
  )
}
