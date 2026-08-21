import { ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { CoinBalance } from '@/components/BalanceCard'

interface PageHeaderProps {
  title: string
  showBack?: boolean
  backTo?: string
}

export function PageHeader({ title, showBack = true, backTo }: PageHeaderProps) {
  const navigate = useNavigate()

  return (
    <header className="mb-5 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {showBack && (
          <button
            type="button"
            onClick={() => (backTo ? navigate(backTo) : navigate(-1))}
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
            aria-label="Назад"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        <h1 className="truncate text-2xl font-bold tracking-tight text-white">{title}</h1>
      </div>
      <CoinBalance className="shrink-0" />
    </header>
  )
}
