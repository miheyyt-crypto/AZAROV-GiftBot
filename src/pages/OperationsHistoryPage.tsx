import { useCallback, useEffect, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { ListSkeleton } from '@/components/ListSkeleton'
import { CoinIcon } from '@/components/CoinIcon'
import { PageHeader } from '@/components/PageHeader'
import { formatBalance } from '@/lib/balance'
import { getUserFacingError } from '@/lib/errors'
import { formatRelativeDay } from '@/lib/format'
import { getOperations } from '@/services/api/operations'
import {
  getSignedOperationAmount,
  iconForOperationType,
  isOperationIncome,
  type Operation,
  type OperationFilter,
} from '@/types/operation'
import type { AppError, LoadState } from '@/types/errors'

const filters: Array<{ id: OperationFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'income', label: 'Приход' },
  { id: 'purchases', label: 'Покупки' },
  { id: 'rewards', label: 'Награды' },
]

function defaultIcon(operation: Operation): string {
  if (operation.icon) {
    return operation.icon
  }
  return iconForOperationType(operation.type, isOperationIncome(operation))
}

export function OperationsHistoryPage() {
  const [filter, setFilter] = useState<OperationFilter>('all')
  const [items, setItems] = useState<Operation[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState<AppError | null>(null)

  const load = useCallback(async () => {
    setLoadState('loading')
    setError(null)
    try {
      const list = await getOperations(filter)
      setItems(list)
      setLoadState(list.length === 0 ? 'empty' : 'success')
    } catch (err) {
      const appError = getUserFacingError(err, 'SERVER_ERROR')
      setError(appError)
      setLoadState('error')
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div
      className="min-h-full overflow-x-hidden bg-bg-dark px-4 pb-6"
      style={{ paddingTop: 'calc(1rem + var(--safe-area-top))' }}
    >
      <PageHeader title="История операций" backTo="/profile" />

      <div className="scrollbar-hide mb-4 -mx-4 overflow-x-auto px-4">
        <div className="flex w-max gap-2">
          {filters.map((item) => {
            const active = filter === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={[
                  'shrink-0 rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap',
                  active
                    ? 'bg-[#9b4dff] text-white shadow-[0_0_16px_rgb(155_77_255/45%)]'
                    : 'bg-white/[0.06] text-white/80',
                ].join(' ')}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      {loadState === 'loading' && (
        <div>
          <p className="mb-3 text-sm text-muted">Загрузка истории...</p>
          <ListSkeleton rows={5} />
        </div>
      )}

      {loadState === 'error' && error && (
        <ErrorState title={error.title} message={error.message} onRetry={() => void load()} />
      )}

      {loadState === 'empty' && (
        <EmptyState
          icon="📜"
          title="История операций пуста"
          description="Здесь будут отображаться твои награды, покупки и другие операции."
        />
      )}

      {loadState === 'success' && (
        <div className="space-y-3">
          {items.map((operation) => {
            const signed = getSignedOperationAmount(operation)
            const income = signed >= 0

            return (
              <article
                key={operation.id}
                className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-lg"
                    aria-hidden
                  >
                    {defaultIcon(operation) === '🪙' ? (
                      <CoinIcon className="size-5" />
                    ) : (
                      defaultIcon(operation)
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className={[
                          'inline-flex items-center gap-1.5 text-sm font-semibold',
                          income ? 'text-gold' : 'text-pink',
                        ].join(' ')}
                      >
                        {income ? '+' : '−'}
                        {formatBalance(Math.abs(signed))}
                        <CoinIcon className="size-3.5" />
                      </p>
                      <span className="shrink-0 text-xs text-muted">
                        {formatRelativeDay(operation.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-white/85">{operation.description}</p>
                    {typeof operation.balanceAfter === 'number' && (
                      <p className="mt-1 text-xs text-muted">
                        Баланс: {formatBalance(operation.balanceAfter)}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
