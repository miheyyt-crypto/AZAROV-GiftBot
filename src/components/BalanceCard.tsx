import { CoinIcon } from '@/components/CoinIcon'
import { useAuth } from '@/components/AuthGate'
import { useBalance } from '@/hooks/useBalance'

interface CoinBalanceProps {
  className?: string
}

export function CoinBalance({ className = '' }: CoinBalanceProps) {
  const { sessionReady } = useAuth()
  const { formatted } = useBalance()

  if (!sessionReady) {
    return (
      <div
        className={['ui-balance-pill text-sm font-semibold text-white', className].join(' ')}
        aria-busy="true"
        aria-label="Баланс загружается"
      >
        <CoinIcon className="size-4 opacity-40" />
        <span className="inline-block h-3.5 w-10 animate-pulse rounded bg-white/15" />
      </div>
    )
  }

  return (
    <div
      className={['ui-balance-pill text-sm font-semibold text-white', className].join(' ')}
      aria-label={`Баланс: ${formatted}`}
    >
      <CoinIcon className="size-4" />
      <span className="tabular-nums tracking-tight">{formatted}</span>
    </div>
  )
}

export const BalanceCard = CoinBalance
