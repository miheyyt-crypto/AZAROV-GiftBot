import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import { ProfileSheet } from '@/components/ProfileSheet'
import { formatBalance } from '@/lib/balance'
import { formatOrderDate, ORDER_STATUS_LABELS } from '@/lib/shop'
import { fetchPendingOrders } from '@/lib/profile'
import type { ShopOrder } from '@/types/shop'

interface ProfileOrdersSheetProps {
  onClose: () => void
}

export function ProfileOrdersSheet({ onClose }: ProfileOrdersSheetProps) {
  const [orders, setOrders] = useState<ShopOrder[]>([])
  const [selected, setSelected] = useState<ShopOrder | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void fetchPendingOrders().then((list) => {
      setOrders(list)
      setIsLoading(false)
    })
  }, [])

  return (
    <ProfileSheet title="Мои заказы" onClose={onClose}>
      {selected ? (
        <article className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mb-4 text-sm text-muted"
          >
            ← Назад к списку
          </button>
          <h3 className="text-base font-semibold text-white">{selected.productName}</h3>
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-gold">
            <CoinIcon className="size-3.5" />
            {formatBalance(selected.price)}
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3 text-muted">
              <dt>Номер заказа</dt>
              <dd className="text-white">№{selected.orderId}</dd>
            </div>
            <div className="flex justify-between gap-3 text-muted">
              <dt>Дата</dt>
              <dd className="text-white">{formatOrderDate(selected.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3 text-muted">
              <dt>Статус</dt>
              <dd className="text-white">{ORDER_STATUS_LABELS[selected.status]}</dd>
            </div>
          </dl>
        </article>
      ) : isLoading ? (
        <p className="py-10 text-center text-sm text-muted">Загружаем заказы...</p>
      ) : orders.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          Нет активных заказов
        </p>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <button
              key={order.orderId}
              type="button"
              onClick={() => setSelected(order)}
              className="flex w-full items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] p-4 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{order.productName}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-gold">
                  <CoinIcon className="size-3.5" />
                  {formatBalance(order.price)}
                </p>
                <p className="mt-2 text-xs text-muted">{ORDER_STATUS_LABELS[order.status]}</p>
                <p className="mt-1 text-xs text-muted">{formatOrderDate(order.createdAt)}</p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-muted" />
            </button>
          ))}
        </div>
      )}
    </ProfileSheet>
  )
}
