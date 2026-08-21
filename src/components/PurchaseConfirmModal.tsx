import { Info, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useNotifications } from '@/components/NotificationProvider'
import { useUserProfile } from '@/hooks/useUserProfile'
import { formatBalance } from '@/lib/balance'
import { createAppError, getUserFacingError } from '@/lib/errors'
import { createPurchaseRequestId, purchaseProduct } from '@/lib/shop'
import type {
  ProductCheckoutField,
  PurchaseFulfillmentData,
  ShopOrder,
  ShopProduct,
} from '@/types/shop'

interface PurchaseConfirmModalProps {
  product: ShopProduct
  balance: number
  onClose: () => void
  onSuccess: (order: ShopOrder) => void
}

function normalizeTelegramUsername(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

function validateField(field: ProductCheckoutField, value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return 'Заполни поле, чтобы оформить заказ.'
  }

  if (field.type === 'telegram_username' || field.type === 'kick_username') {
    const username = normalizeTelegramUsername(trimmed)
    if (!/^@[A-Za-z0-9_]{4,32}$/.test(username)) {
      return 'Укажи корректный @username.'
    }
    return null
  }

  if (field.type === 'usdt_trc20') {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) {
      return 'Укажи USDT-адрес сети TRC-20 (начинается с T).'
    }
    return null
  }

  return null
}

function buildFulfillment(
  field: ProductCheckoutField | null | undefined,
  value: string,
): PurchaseFulfillmentData {
  if (!field) {
    return {}
  }

  if (field.type === 'telegram_username') {
    return { telegramUsername: normalizeTelegramUsername(value) }
  }
  if (field.type === 'usdt_trc20') {
    return { usdtAddress: value.trim() }
  }
  return { kickUsername: value.trim() }
}

export function PurchaseConfirmModal({
  product,
  balance,
  onClose,
  onSuccess,
}: PurchaseConfirmModalProps) {
  const { showNotification } = useNotifications()
  const { user } = useUserProfile()
  const [visible, setVisible] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [requestId] = useState(() => createPurchaseRequestId())
  const field = product.checkoutField ?? null

  const initialValue = useMemo(() => {
    if (!field) {
      return ''
    }
    if (field.type === 'telegram_username' && user.username) {
      return `@${user.username.replace(/^@/, '')}`
    }
    return ''
  }, [field, user.username])

  const [fieldValue, setFieldValue] = useState(initialValue)
  const canAfford = balance >= product.price

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  function close() {
    setVisible(false)
    window.setTimeout(onClose, 180)
  }

  async function handleBuy() {
    if (!canAfford) {
      const error = createAppError('INSUFFICIENT_BALANCE')
      showNotification({ type: 'warning', title: error.title, message: error.message })
      return
    }

    if (field) {
      const validationError = validateField(field, fieldValue)
      if (validationError) {
        showNotification({
          type: 'warning',
          title: 'Проверь данные',
          message: validationError,
        })
        return
      }
    }

    if (isSubmitting) {
      return
    }

    setIsSubmitting(true)
    try {
      const fulfillment = buildFulfillment(field, fieldValue)
      const result = await purchaseProduct(product.id, requestId, fulfillment)

      if (result.success && result.order) {
        showNotification({
          type: 'success',
          title: 'Заявка оформлена',
          message: 'Статус увидишь в «Моих заказах».',
        })
        onSuccess(result.order)
        return
      }

      const appError = getUserFacingError(
        result.code ?? result.message,
        result.code === 'INSUFFICIENT_BALANCE' || result.code === 'INSUFFICIENT_FUNDS'
          ? 'INSUFFICIENT_BALANCE'
          : 'UNKNOWN_ERROR',
      )
      showNotification({
        type: 'error',
        title: 'Не удалось оформить покупку',
        message: result.message ?? appError.message,
      })
    } catch (error) {
      const appError = getUserFacingError(error)
      showNotification({
        type: 'error',
        title: 'Не удалось оформить покупку',
        message: appError.message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const ctaLabel = !canAfford
    ? 'Не хватает монет'
    : isSubmitting
      ? 'Оформляем...'
      : 'Купить'

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <button
        type="button"
        className={[
          'press-none absolute inset-0 bg-black/75 backdrop-blur-[2px] transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-label="Закрыть"
        onClick={close}
      />

      <section
        className={[
          'relative z-10 flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#121018] shadow-[0_-16px_48px_rgb(0_0_0/55%)] transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        ].join(' ')}
        style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom))' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-checkout-title"
      >
        <div className="flex justify-center pt-3">
          <span className="h-1.5 w-12 rounded-full bg-white/20" />
        </div>

        <header className="flex items-start justify-between gap-3 px-5 pt-2">
          <h2
            id="product-checkout-title"
            className="pr-2 text-[22px] font-bold leading-tight tracking-tight text-white"
          >
            {product.name}
          </h2>
          <button
            type="button"
            onClick={close}
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </header>

        <div className="mt-3 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-2">
          <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-[24px] border border-white/8 bg-[radial-gradient(circle_at_50%_40%,rgb(168_85_247/18%),transparent_62%)]">
            <img
              src={product.image}
              alt=""
              className={[
                'size-full object-contain p-5 drop-shadow-[0_12px_28px_rgb(0_0_0/40%)]',
                product.imageClassName,
              ]
                .filter(Boolean)
                .join(' ')}
            />
          </div>

          <p className="mt-4 flex items-center gap-2 text-[28px] font-bold leading-none text-[#f0c45a]">
            <span aria-hidden className="text-[24px]">
              🪙
            </span>
            {formatBalance(product.price)}
          </p>

          {product.detailText && (
            <p className="mt-3 text-[13px] leading-relaxed text-white/70">{product.detailText}</p>
          )}

          <div className="mt-4 flex items-start gap-3 rounded-[18px] border border-white/8 bg-white/[0.05] px-3.5 py-3">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80">
              <Info size={14} aria-hidden />
            </span>
            <p className="text-[13px] leading-relaxed text-white/75">{product.infoText}</p>
          </div>

          {field && (
            <div className="mt-4">
              <label
                htmlFor={`checkout-field-${product.id}`}
                className="text-sm font-medium text-white"
              >
                {field.label}
              </label>
              <input
                id={`checkout-field-${product.id}`}
                type="text"
                value={fieldValue}
                onChange={(event) => setFieldValue(event.target.value)}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck={false}
                className="mt-2 w-full rounded-[16px] border border-white/10 bg-[#1a1724] px-4 py-3.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-neon-purple/50"
              />
              <p className="mt-2 text-[12px] leading-relaxed text-white/45">{field.hint}</p>
            </div>
          )}
        </div>

        <div className="px-5 pt-2">
          <button
            type="button"
            onClick={handleBuy}
            disabled={!canAfford || isSubmitting}
            className={[
              'w-full rounded-[18px] px-4 py-3.5 text-base font-bold text-white',
              canAfford
                ? 'bg-gradient-to-r from-[#8b3dff] to-[#b56bff] shadow-[0_0_24px_rgb(155_77_255/45%)]'
                : 'cursor-not-allowed bg-[#6b4aa8]/55 opacity-80',
            ].join(' ')}
          >
            {ctaLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
