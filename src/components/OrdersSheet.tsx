import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { formatBalance } from '@/lib/balance'
import {
  formatOrderDate,
  getUserOrders,
  ORDER_STATUS_HINTS,
  ORDER_STATUS_LABELS,
} from '@/lib/shop'
import type { ShopOrder } from '@/types/shop'

interface OrdersSheetProps {
  onClose: () => void
}

export function OrdersSheet({ onClose }: OrdersSheetProps) {
  const [visible, setVisible] = useState(false)
  const [orders, setOrders] = useState<ShopOrder[]>([])
  const [selected, setSelected] = useState<ShopOrder | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    void getUserOrders().then((list) => {
      setOrders(list)
      setIsLoading(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  function close() {
    setVisible(false)
    window.setTimeout(onClose, 180)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <button
        type="button"
        className={['press-none absolute inset-0 bg-black/70 transition-opacity duration-200', visible ? 'opacity-100' : 'opacity-0'].join(' ')}
        aria-label="Закрыть"
        onClick={close}
      />
      <section
        className={[
          'relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[32px] border border-white/10 bg-bg-dark transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        ].join(' ')}
        style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom))' }}
      >
        <header className="flex items-center gap-3 px-5 pt-5">
          <button
            type="button"
            onClick={selected ? () => setSelected(null) : close}
            className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
            aria-label="Назад"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-xl font-bold text-white">
            {selected ? 'Заказ' : 'Мои заказы'}
          </h2>
        </header>

        <div className="mt-4 flex-1 overflow-y-auto px-5 pb-4">
          {selected ? (
            <article className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
              <h3 className="text-base font-semibold text-white">{selected.productName}</h3>
              <p className="mt-3 text-sm text-gold">🪙 {formatBalance(selected.price)}</p>
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
              <p className="mt-4 text-sm leading-relaxed text-muted">
                {ORDER_STATUS_HINTS[selected.status]}
              </p>
            </article>
          ) : isLoading ? (
            <p className="py-10 text-center text-sm text-muted">Загружаем заказы...</p>
          ) : orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">У тебя пока нет заказов</p>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <button
                  key={order.orderId}
                  type="button"
                  onClick={() => setSelected(order)}
                  className="flex w-full items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-white">{order.productName}</p>
                    <p className="mt-1 text-sm text-gold">🪙 {formatBalance(order.price)}</p>
                    <p className="mt-2 text-xs text-muted">{ORDER_STATUS_LABELS[order.status]}</p>
                    <p className="mt-1 text-xs text-muted">{formatOrderDate(order.createdAt)}</p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-muted" />
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
