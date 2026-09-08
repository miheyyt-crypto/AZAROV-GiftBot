import { CoinIcon } from '@/components/CoinIcon'
import { useBalance } from '@/hooks/useBalance'

interface CoinBalanceProps {
  className?: string
}

export function CoinBalance({ className = '' }: CoinBalanceProps) {
  const { formatted } = useBalance()

  return (
    <div
      className={[
        'inline-flex items-center gap-1.5 rounded-full border border-gold/55',
        'bg-black/35 px-3 py-1.5 text-sm font-semibold text-white',
        'shadow-[var(--glow-gold)] backdrop-blur-sm',
        className,
      ].join(' ')}
      aria-label={`Баланс: ${formatted}`}
    >
      <CoinIcon className="size-4" />
      <span>{formatted}</span>
    </div>
  )
}

export const BalanceCard = CoinBalance
