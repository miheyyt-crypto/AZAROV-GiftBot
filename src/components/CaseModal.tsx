import { Settings, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { CaseRewardCard } from '@/components/CaseRewardCard'
import { useNotifications } from '@/components/NotificationProvider'
import coinsImage from '@/assets/cases/reward-coins.png'
import { isDropTableValid } from '@/data/cases'
import { formatBalance } from '@/lib/balance'
import { openCase } from '@/lib/cases'
import { createAppError } from '@/lib/errors'
import { createPurchaseRequestId } from '@/lib/shop'
import { RARITY_LABELS } from '@/types/case'
import type { CaseOpening, GiftCase } from '@/types/case'

const OPEN_ANIMATION_MS = 1200

interface CaseModalProps {
  giftCase: GiftCase
  balance: number
  availableReferralCases: number
  onClose: () => void
}

export function CaseModal({
  giftCase,
  balance,
  availableReferralCases,
  onClose,
}: CaseModalProps) {
  const { showNotification } = useNotifications()
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<'preview' | 'opening' | 'result'>('preview')
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<CaseOpening | null>(null)
  const [requestId, setRequestId] = useState(() => createPurchaseRequestId())

  const price = giftCase.price ?? 0
  const isReferral = giftCase.type === 'referral'
  const canAfford = isReferral || balance >= price
  const missing = Math.max(0, price - balance)
  const dropValid = isDropTableValid(giftCase.rewards)
  const canOpenReferral = isReferral && availableReferralCases > 0
  const canSubmit =
    dropValid &&
    phase === 'preview' &&
    (isReferral ? canOpenReferral : canAfford)

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
    if (phase === 'opening') {
      return
    }

    setVisible(false)
    window.setTimeout(onClose, 180)
  }

  function buttonLabel(): ReactNode {
    if (!dropValid) {
      return 'Открытие временно недоступно'
    }

    if (phase === 'opening') {
      return 'Открываем...'
    }

    if (isReferral) {
      return canOpenReferral ? 'Открыть кейс' : 'Получается за каждые 5 друзей'
    }

    if (!canAfford) {
      return 'Не хватает монет'
    }

    return (
      <span className="inline-flex items-center justify-center gap-2">
        <span>Открыть за {formatBalance(price)}</span>
        <img
          src={coinsImage}
          alt=""
          className="size-5 object-contain"
          draggable={false}
          aria-hidden
        />
      </span>
    )
  }

  async function handleOpen() {
    if (!canSubmit) {
      if (!canAfford && !isReferral) {
        const insufficient = createAppError('INSUFFICIENT_BALANCE')
        showNotification({
          type: 'warning',
          title: 'Не удалось открыть кейс',
          message: insufficient.message,
        })
      }
      return
    }

    setError(null)
    setPhase('opening')
    const startedAt = Date.now()
    const result = await openCase(giftCase.id, requestId)
    const wait = Math.max(0, OPEN_ANIMATION_MS - (Date.now() - startedAt))

    window.setTimeout(() => {
      if (result.success && result.opening) {
        setOpening(result.opening)
        setPhase('result')
        showNotification({
          type: 'reward',
          title: 'Кейс открыт!',
          message: result.opening.prize.name,
        })
        return
      }

      setPhase('preview')
      setRequestId(createPurchaseRequestId())
      const message = result.message ?? 'Попробуй ещё раз.'
      setError(message)
      showNotification({
        type: 'error',
        title: 'Не удалось открыть кейс',
        message,
      })
    }, wait)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <button
        type="button"
        className={[
          'press-none absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-label="Закрыть"
        onClick={close}
      />

      <section
        className={[
          'relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[32px] border border-white/10 bg-bg-dark shadow-[0_-12px_48px_rgb(0_0_0/45%)] transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-modal-title"
      >
        <div className="flex justify-center pt-3">
          <span className="h-1.5 w-12 rounded-full bg-white/20" />
        </div>

        <header className="flex items-center justify-between gap-3 px-5 pt-3 pb-2">
          <h2 id="case-modal-title" className="text-xl font-bold text-white">
            {giftCase.name}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={phase === 'opening'}
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white disabled:opacity-50"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {phase === 'result' && opening ? (
            <div className="py-6 text-center">
              <p className="text-4xl" aria-hidden>
                🎉
              </p>
              <h3 className="mt-3 text-xl font-bold text-white">Поздравляем!</h3>
              <p className="mt-2 text-sm text-muted">Ты получил</p>
              <p className="mt-3 text-2xl font-bold text-gold">{opening.prize.name}</p>
              <p className="mt-2 text-sm font-medium text-neon-purple">
                {RARITY_LABELS[opening.prize.rarity]}
              </p>
            </div>
          ) : (
            <>
              <div className="mx-auto mt-2 aspect-square w-40 overflow-hidden rounded-[28px] border border-white/10 bg-bg-surface">
                <img src={giftCase.image} alt="" className="size-full object-cover" />
              </div>
              <p className="mt-4 text-center text-sm leading-relaxed text-muted">
                {giftCase.description}
              </p>

              <div className="mt-5 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-white">Что внутри</h3>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted">
                  <Settings size={12} aria-hidden />
                  Шансы реальные
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 items-stretch gap-3">
                {giftCase.rewards.map((reward) => (
                  <CaseRewardCard key={reward.id} reward={reward} />
                ))}
              </div>
            </>
          )}

          {error && phase === 'preview' && (
            <p className="mt-4 rounded-xl border border-pink/30 bg-pink/10 px-3 py-3 text-sm text-pink">
              {error}
            </p>
          )}

          {!canAfford && !isReferral && phase !== 'result' && (
            <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-muted">
              Нужно ещё {formatBalance(missing)} монет
            </p>
          )}
        </div>

        <div
          className="border-t border-white/10 bg-bg-dark px-5 pt-3"
          style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom))' }}
        >
          {phase === 'result' ? (
            <button
              type="button"
              onClick={close}
              className="w-full rounded-2xl bg-gradient-to-r from-purple to-neon-purple px-4 py-3.5 text-sm font-semibold text-white"
            >
              Отлично
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpen}
              disabled={!canSubmit}
              className="w-full rounded-2xl bg-gradient-to-r from-purple to-neon-purple px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {buttonLabel()}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
