import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { CoinIcon } from '@/components/CoinIcon'
import { formatBalance } from '@/lib/balance'
import { formatAbsoluteDateTime } from '@/lib/format'
import {
  ORDER_STATUS_EMOJI,
  ORDER_STATUS_LABELS,
  type Order,
  type OrderStatus,
} from '@/types/order'

interface OrderDetailSheetProps {
  order: Order
  onClose: () => void
}

const statusAccent: Record<OrderStatus, string> = {
  pending: 'text-amber-300',
  processing: 'text-sky-300',
  completed: 'text-kick',
  cancelled: 'text-muted',
  rejected: 'text-pink',
  refunded: 'text-neon-purple',
}

export function OrderDetailSheet({ order, onClose }: OrderDetailSheetProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  function close() {
    setVisible(false)
    window.setTimeout(onClose, 180)
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <button
        type="button"
        className={[
          'press-none ui-overlay absolute inset-0 transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-label="Закрыть"
        onClick={close}
      />
      <section
        className={[
          'relative z-10 max-h-[88vh] w-full max-w-lg overflow-y-auto ui-sheet p-5 transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        ].join(' ')}
        style={{ paddingBottom: 'calc(1.25rem + var(--safe-area-bottom))' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-detail-title"
      >
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 id="order-detail-title" className="text-xl font-bold text-white">
            Заказ #{order.id}
          </h2>
          <button
            type="button"
            onClick={close}
            className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </header>

        <div className="mx-auto mb-4 flex size-28 items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-bg-surface">
          {order.productImage ? (
            <img src={order.productImage} alt="" className="size-full object-contain p-3" />
          ) : (
            <span className="text-4xl" aria-hidden>
              🎁
            </span>
          )}
        </div>

        <h3 className="text-center text-lg font-semibold text-white">{order.productName}</h3>

        <dl className="mt-5 space-y-3 rounded-[20px] border border-white/10 bg-white/[0.04] p-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Количество</dt>
            <dd className="font-medium text-white">{order.quantity}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Стоимость</dt>
            <dd className="inline-flex items-center gap-1.5 font-semibold text-gold">
              {formatBalance(order.price)}
              <CoinIcon className="size-4" />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Статус</dt>
            <dd className={['font-medium', statusAccent[order.status]].join(' ')}>
              {ORDER_STATUS_EMOJI[order.status]} {ORDER_STATUS_LABELS[order.status]}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Создан</dt>
            <dd className="text-right font-medium text-white">
              {formatAbsoluteDateTime(order.createdAt)}
            </dd>
          </div>
          {order.telegramUsername && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Telegram</dt>
              <dd className="font-medium text-white">{order.telegramUsername}</dd>
            </div>
          )}
          {order.usdtAddress && (
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted">USDT TRC20</dt>
              <dd className="break-all text-right font-medium text-white">{order.usdtAddress}</dd>
            </div>
          )}
          {order.kickUsername && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Kick / контакт</dt>
              <dd className="font-medium text-white">{order.kickUsername}</dd>
            </div>
          )}
          {order.donateNickname && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Ник</dt>
              <dd className="font-medium text-white">{order.donateNickname}</dd>
            </div>
          )}
          {order.donateText && (
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted">Текст доната</dt>
              <dd className="break-words text-right font-medium text-white">{order.donateText}</dd>
            </div>
          )}
          {order.trackUrl && (
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted">Ссылка на трек</dt>
              <dd className="break-all text-right font-medium text-white">{order.trackUrl}</dd>
            </div>
          )}
        </dl>

        {order.comment && (
          <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Комментарий</p>
            <p className="mt-2 text-sm leading-relaxed text-white/90">{order.comment}</p>
          </div>
        )}

        {order.info && (
          <div className="mt-3 rounded-[18px] border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Информация по заказу
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/90">{order.info}</p>
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
