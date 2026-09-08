import { CoinIcon } from '@/components/CoinIcon'
import { useBalance } from '@/hooks/useBalance'

interface CoinBalanceProps {
  className?: string
}

export function CoinBalance({ className = '' }: CoinBalanceProps) {
  const { formatted } = useBalance()

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
