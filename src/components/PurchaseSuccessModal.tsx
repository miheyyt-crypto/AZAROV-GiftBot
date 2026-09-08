import { useEffect, useState } from 'react'

import type { ShopOrder } from '@/types/shop'

interface PurchaseSuccessModalProps {
  order: ShopOrder
  onClose: () => void
  onOpenOrders: () => void
}

export function PurchaseSuccessModal({
  order,
  onClose,
  onOpenOrders,
}: PurchaseSuccessModalProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <button
        type="button"
        className={['press-none ui-overlay absolute inset-0 transition-opacity duration-200', visible ? 'opacity-100' : 'opacity-0'].join(' ')}
        aria-label="Закрыть"
        onClick={onClose}
      />
      <section
        className={[
          'relative z-10 w-full max-w-lg ui-sheet p-5 transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        ].join(' ')}
        style={{ paddingBottom: 'calc(1.25rem + var(--safe-area-bottom))' }}
      >
        <h2 className="text-xl font-bold text-white">✓ Покупка оформлена</h2>
        <p className="mt-2 text-sm font-medium text-white">{order.productName}</p>
        <p className="mt-2 text-sm text-muted">Заказ создан и ожидает выполнения.</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white"
          >
            Закрыть
          </button>
          <button
            type="button"
            onClick={onOpenOrders}
            className="rounded-2xl bg-gradient-to-r from-purple to-neon-purple px-4 py-3 text-sm font-semibold text-white"
          >
            Мои заказы
          </button>
        </div>
      </section>
    </div>
  )
}
