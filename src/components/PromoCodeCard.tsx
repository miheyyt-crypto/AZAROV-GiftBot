import { useState } from 'react'

import { useNotifications } from '@/components/NotificationProvider'
import {
  normalizePromoInput,
  promoErrorMessage,
  redeemPromoCode,
} from '@/lib/promo'

type PromoCodeCardProps = {
  className?: string
}

export function PromoCodeCard({ className = '' }: PromoCodeCardProps) {
  const { showNotification } = useNotifications()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const normalized = normalizePromoInput(value)
  const canSubmit = normalized.length >= 3 && !busy

  async function handleSubmit() {
    if (!canSubmit) {
      return
    }

    setBusy(true)
    try {
      const result = await redeemPromoCode(normalized)
      if (!result.success) {
        showNotification({
          type: 'error',
          title: 'Промокод',
          message: promoErrorMessage(result.code, result.message),
        })
        return
      }

      const reward = Math.max(0, Math.floor(Number(result.reward) || 0))
      showNotification({
        type: 'success',
        title: 'Промокод активирован!',
        message: reward > 0 ? `+${reward} 🪙 · баланс обновлён` : 'Баланс обновлён',
      })
      setValue('')
    } catch {
      showNotification({
        type: 'error',
        title: 'Промокод',
        message: 'Не удалось активировать промокод. Попробуй ещё раз.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={[
        'rounded-[22px] border border-white/10 bg-[#17151f] p-4 shadow-[0_8px_24px_rgb(0_0_0/28%)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <h3 className="text-[15px] font-medium text-[#b8b4c4]">Промокод</h3>

      <div className="mt-3 flex items-stretch gap-2.5">
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          disabled={busy}
          placeholder="СЛОВО СО СТРИМА"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void handleSubmit()
            }
          }}
          className={[
            'min-h-12 min-w-0 flex-1 rounded-full border border-white/5 bg-[#0b0a10]',
            'px-4 text-[13px] font-semibold uppercase tracking-[0.04em] text-white',
            'placeholder:text-[#6f6a7c] outline-none',
            'focus:border-kick/35 focus:ring-1 focus:ring-kick/25',
            'disabled:opacity-60',
          ].join(' ')}
          aria-label="Промокод"
        />

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          className={[
            'inline-flex min-h-12 shrink-0 items-center justify-center rounded-full px-5',
            'bg-kick text-[14px] font-bold text-[#0b1208]',
            'shadow-[0_0_18px_rgb(83_204_24/35%)]',
            'transition-transform duration-150 active:scale-[0.97]',
            'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
          ].join(' ')}
        >
          {busy ? '…' : 'Ввести'}
        </button>
      </div>
    </section>
  )
}
