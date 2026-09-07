import { useEffect, useState } from 'react'

import { ProfileSheet } from '@/components/ProfileSheet'
import { formatBalance } from '@/lib/balance'
import {
  fetchCoinHistory,
  formatTransactionDate,
} from '@/lib/profile'
import type { CoinHistoryFilter, CoinTransaction } from '@/types/profile'

interface CoinHistorySheetProps {
  onClose: () => void
}

const tabs: Array<{ id: CoinHistoryFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'income', label: 'Приход' },
  { id: 'expense', label: 'Расход' },
]

export function CoinHistorySheet({ onClose }: CoinHistorySheetProps) {
  const [activeTab, setActiveTab] = useState<CoinHistoryFilter>('all')
  const [transactions, setTransactions] = useState<CoinTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setIsLoading(true)
    void fetchCoinHistory(activeTab).then((list) => {
      setTransactions(list)
      setIsLoading(false)
    })
  }, [activeTab])

  return (
    <ProfileSheet title="История монет" onClose={onClose}>
      <div className="mb-4 flex gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={[
              'flex-1 rounded-xl px-3 py-2 text-sm font-medium transition',
              activeTab === tab.id
                ? 'bg-white/10 text-white'
                : 'bg-white/[0.03] text-muted',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted">Загружаем историю...</p>
      ) : transactions.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">История пока пуста</p>
      ) : (
        <div className="space-y-3">
          {transactions.map((item) => {
            const isIncome = item.amount > 0

            return (
              <article
                key={item.id}
                className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{item.label}</p>
                    <p className="mt-1 text-xs text-muted">
                      {formatTransactionDate(item.createdAt)}
                    </p>
                  </div>
                  <p
                    className={[
                      'shrink-0 text-sm font-semibold',
                      isIncome ? 'text-gold' : 'text-red-400',
                    ].join(' ')}
                  >
                    {isIncome ? '+' : '−'}
                    {formatBalance(Math.abs(item.amount))}
                  </p>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </ProfileSheet>
  )
}
