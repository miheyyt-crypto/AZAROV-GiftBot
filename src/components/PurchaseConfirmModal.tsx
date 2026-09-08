import { Info, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
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

  if (field.maxLength && trimmed.length > field.maxLength) {
    return `Максимум ${field.maxLength} символов.`
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

  if (field.type === 'donate_nickname') {
    if (trimmed.length > (field.maxLength ?? 20)) {
      return 'Ник — максимум 20 символов.'
    }
    return null
  }

  if (field.type === 'donate_text') {
    if (trimmed.length > (field.maxLength ?? 300)) {
      return 'Текст доната — максимум 300 символов.'
    }
    return null
  }

  if (field.type === 'track_url') {
    try {
      const url = new URL(trimmed)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return 'Ссылка должна начинаться с https://'
      }
    } catch {
      return 'Укажи корректную ссылку на трек (YouTube или SoundCloud).'
    }
    return null
  }

  return null
}

function fieldToFulfillment(
  field: ProductCheckoutField,
  value: string,
): PurchaseFulfillmentData {
  if (field.type === 'telegram_username') {
    return { telegramUsername: normalizeTelegramUsername(value) }
  }
  if (field.type === 'usdt_trc20') {
    return { usdtAddress: value.trim() }
  }
  if (field.type === 'kick_username') {
    return { kickUsername: value.trim() }
  }
  if (field.type === 'donate_nickname') {
    return { donateNickname: value.trim() }
  }
  if (field.type === 'donate_text') {
    return { donateText: value.trim() }
  }
  return { trackUrl: value.trim() }
}

function buildFulfillment(
  fields: ProductCheckoutField[],
  values: Record<string, string>,
): PurchaseFulfillmentData {
  return fields.reduce<PurchaseFulfillmentData>((acc, field) => {
    return { ...acc, ...fieldToFulfillment(field, values[field.type] ?? '') }
  }, {})
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

  const fields = useMemo<ProductCheckoutField[]>(() => {
    if (product.checkoutFields?.length) {
      return product.checkoutFields
    }
    return product.checkoutField ? [product.checkoutField] : []
  }, [product.checkoutField, product.checkoutFields])

  const initialValues = useMemo(() => {
    const next: Record<string, string> = {}
    for (const field of fields) {
      if (field.type === 'telegram_username' && user.username) {
        next[field.type] = `@${user.username.replace(/^@/, '')}`
      } else {
        next[field.type] = ''
      }
    }
    return next
  }, [fields, user.username])

  const [fieldValues, setFieldValues] = useState(initialValues)
  const canAfford = balance >= product.price

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  function close() {
    setVisible(false)
    window.setTimeout(onClose, 180)
  }

  function updateField(type: string, value: string, maxLength?: number) {
    const nextValue = typeof maxLength === 'number' ? value.slice(0, maxLength) : value
    setFieldValues((prev) => ({ ...prev, [type]: nextValue }))
  }

  async function handleBuy() {
    if (!canAfford) {
      const error = createAppError('INSUFFICIENT_BALANCE')
      showNotification({ type: 'warning', title: error.title, message: error.message })
      return
    }

    for (const field of fields) {
      const validationError = validateField(field, fieldValues[field.type] ?? '')
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
      const fulfillment = buildFulfillment(fields, fieldValues)
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
          'relative z-10 flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden ui-sheet transition-all duration-200',
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
            <CoinIcon className="size-7" />
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

          {fields.map((field) => {
            const value = fieldValues[field.type] ?? ''
            const inputId = `checkout-field-${product.id}-${field.type}`
            const isMultiline = field.type === 'donate_text'

            return (
              <div key={field.type} className="mt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor={inputId} className="text-sm font-medium text-white">
                    {field.label}
                  </label>
                  {field.maxLength ? (
                    <span className="text-[11px] text-white/40">
                      {value.length}/{field.maxLength}
                    </span>
                  ) : null}
                </div>
                {isMultiline ? (
                  <textarea
                    id={inputId}
                    value={value}
                    onChange={(event) =>
                      updateField(field.type, event.target.value, field.maxLength)
                    }
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    rows={4}
                    autoComplete="off"
                    spellCheck={false}
                    className="mt-2 w-full resize-none rounded-[16px] border border-white/10 bg-[#1a1724] px-4 py-3.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-neon-purple/50"
                  />
                ) : (
                  <input
                    id={inputId}
                    type="text"
                    value={value}
                    onChange={(event) =>
                      updateField(field.type, event.target.value, field.maxLength)
                    }
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    autoComplete="off"
                    spellCheck={false}
                    className="mt-2 w-full rounded-[16px] border border-white/10 bg-[#1a1724] px-4 py-3.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-neon-purple/50"
                  />
                )}
                {field.hint ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-white/45">{field.hint}</p>
                ) : null}
              </div>
            )
          })}
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
