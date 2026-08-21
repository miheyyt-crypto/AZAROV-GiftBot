import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { ListSkeleton } from '@/components/ListSkeleton'
import { OrderDetailSheet } from '@/components/OrderDetailSheet'
import { PageHeader } from '@/components/PageHeader'
import { formatBalance } from '@/lib/balance'
import { getUserFacingError } from '@/lib/errors'
import { formatOrderListDate } from '@/lib/format'
import { ROUTES } from '@/lib/constants'
import { getOrders } from '@/services/api/orders'
import type { AppError, LoadState } from '@/types/errors'
import {
  ORDER_STATUS_EMOJI,
  ORDER_STATUS_LABELS,
  type Order,
  type OrderStatus,
} from '@/types/order'

const statusAccent: Record<OrderStatus, string> = {
  pending: 'text-amber-300',
  processing: 'text-sky-300',
  completed: 'text-kick',
  cancelled: 'text-muted',
  rejected: 'text-pink',
  refunded: 'text-neon-purple',
}

export function OrdersPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<Order[]>([])
  const [selected, setSelected] = useState<Order | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState<AppError | null>(null)

  const load = useCallback(async () => {
    setLoadState('loading')
    setError(null)
    try {
      const list = await getOrders()
      setItems(list)
      setLoadState(list.length === 0 ? 'empty' : 'success')
    } catch (err) {
      const appError = getUserFacingError(err, 'SERVER_ERROR')
      setError(appError)
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div
      className="min-h-full overflow-x-hidden bg-bg-dark px-4 pb-6"
      style={{ paddingTop: 'calc(1rem + var(--safe-area-top))' }}
    >
      <PageHeader title="Мои заказы" />

      {loadState === 'loading' && (
        <div>
          <p className="mb-3 text-sm text-muted">Загрузка заказов...</p>
          <ListSkeleton rows={4} />
        </div>
      )}

      {loadState === 'error' && error && (
        <ErrorState title={error.title} message={error.message} onRetry={() => void load()} />
      )}

      {loadState === 'empty' && (
        <EmptyState
          icon="🛒"
          title="У тебя пока нет заказов"
          description="Когда ты что-нибудь приобретёшь в магазине, заказ появится здесь."
          action={
            <button
              type="button"
              onClick={() => navigate(ROUTES.shop)}
              className="rounded-2xl bg-[#9b4dff] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgb(155_77_255/35%)]"
            >
              Перейти в магазин
            </button>
          }
        />
      )}

      {loadState === 'success' && (
        <div className="space-y-3">
          {items.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => setSelected(order)}
              className="flex w-full items-start gap-3 rounded-[22px] border border-white/10 bg-white/[0.04] p-4 text-left"
            >
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-bg-surface">
                {order.productImage ? (
                  <img
                    src={order.productImage}
                    alt=""
                    className="size-full object-contain p-1.5"
                  />
                ) : (
                  <span aria-hidden>🎁</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-white">{order.productName}</h3>
                <p className="mt-1 text-sm font-semibold text-gold">
                  {formatBalance(order.price)} 🪙
                </p>
                <p className="mt-1 text-xs text-muted">Заказ #{order.id}</p>
                <p className="mt-0.5 text-xs text-muted">{formatOrderListDate(order.createdAt)}</p>
                <p className={['mt-2 text-xs font-medium', statusAccent[order.status]].join(' ')}>
                  {ORDER_STATUS_EMOJI[order.status]} {ORDER_STATUS_LABELS[order.status]}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <OrderDetailSheet order={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
