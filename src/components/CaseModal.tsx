import { Settings, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { CaseOpeningReel } from '@/components/CaseOpeningReel'
import { CaseRewardCard } from '@/components/CaseRewardCard'
import { CoinIcon } from '@/components/CoinIcon'
import { useNotifications } from '@/components/NotificationProvider'
import { isDropTableValid } from '@/data/cases'
import { formatBalance } from '@/lib/balance'
import {
  CASE_OPENING_DURATION_MS,
  buildCaseOpeningReel,
  resolveWinnerReward,
  type CaseReelItem,
} from '@/lib/case-opening-reel'
import { openCase } from '@/lib/cases'
import { createAppError } from '@/lib/errors'
import { createPurchaseRequestId } from '@/lib/shop'
import { RARITY_LABELS } from '@/types/case'
import type { CaseOpening, GiftCase } from '@/types/case'

type CaseModalPhase = 'preview' | 'requesting' | 'animating' | 'result'

interface CaseModalProps {
  giftCase: GiftCase
  balance: number
  availableReferralCases: number
  onClose: () => void
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function CaseModal({
  giftCase,
  balance,
  availableReferralCases,
  onClose,
}: CaseModalProps) {
  const { showNotification } = useNotifications()
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<CaseModalPhase>('preview')
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<CaseOpening | null>(null)
  const [requestId, setRequestId] = useState(() => createPurchaseRequestId())
  const [reelItems, setReelItems] = useState<CaseReelItem[]>([])
  const [winnerIndex, setWinnerIndex] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const openingInFlightRef = useRef(false)
  const prizeNameRef = useRef('')

  const price = giftCase.price ?? 0
  const isReferral = giftCase.type === 'referral'
  const canAfford = isReferral || balance >= price
  const missing = Math.max(0, price - balance)
  const dropValid = isDropTableValid(giftCase.rewards)
  const canOpenReferral = isReferral && availableReferralCases > 0
  const busy = phase === 'requesting' || phase === 'animating'
  const canSubmit =
    dropValid &&
    phase === 'preview' &&
    !openingInFlightRef.current &&
    (isReferral ? canOpenReferral : canAfford)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setReducedMotion(prefersReducedMotion())

    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  function close() {
    if (busy) {
      return
    }

    setVisible(false)
    window.setTimeout(onClose, 180)
  }

  function buttonLabel(): ReactNode {
    if (!dropValid) {
      return 'Открытие временно недоступно'
    }

    if (phase === 'requesting') {
      return 'Открываем...'
    }

    if (phase === 'animating') {
      return 'Крутим...'
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
        <CoinIcon className="size-5" />
      </span>
    )
  }

  const handleReelComplete = useCallback(() => {
    setPhase('result')
    openingInFlightRef.current = false
    if (prizeNameRef.current) {
      showNotification({
        type: 'reward',
        title: 'Кейс открыт!',
        message: prizeNameRef.current,
      })
    }
  }, [showNotification])

  async function handleOpen() {
    if (!canSubmit || openingInFlightRef.current) {
      if (!canAfford && !isReferral && phase === 'preview') {
        const insufficient = createAppError('INSUFFICIENT_BALANCE')
        showNotification({
          type: 'warning',
          title: 'Не удалось открыть кейс',
          message: insufficient.message,
        })
      }
      return
    }

    openingInFlightRef.current = true
    setError(null)
    setPhase('requesting')
    setReelItems([])
    setOpening(null)

    try {
      const result = await openCase(giftCase.id, requestId)

      if (!result.success || !result.opening) {
        openingInFlightRef.current = false
        setPhase('preview')
        setRequestId(createPurchaseRequestId())
        const message = result.message ?? 'Попробуй ещё раз.'
        setError(message)
        showNotification({
          type: 'error',
          title: 'Не удалось открыть кейс',
          message,
        })
        return
      }

      const winnerReward = resolveWinnerReward(giftCase.rewards, result.opening)
      const reel = buildCaseOpeningReel({
        pool: giftCase.rewards,
        winner: winnerReward,
      })

      prizeNameRef.current = result.opening.prize.name
      setOpening(result.opening)
      setReelItems(reel.items)
      setWinnerIndex(reel.winnerIndex)
      setPhase('animating')
    } catch {
      openingInFlightRef.current = false
      setPhase('preview')
      setRequestId(createPurchaseRequestId())
      const message = 'Не удалось открыть кейс. Попробуй ещё раз.'
      setError(message)
      showNotification({
        type: 'error',
        title: 'Не удалось открыть кейс',
        message,
      })
    }
  }

  const reelKey = useMemo(() => {
    if (!opening) {
      return 'idle'
    }
    return `${opening.openingId}:${winnerIndex}`
  }, [opening, winnerIndex])

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <button
        type="button"
        className={[
          'press-none ui-overlay absolute inset-0 transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-label="Закрыть"
        onClick={close}
        disabled={busy}
      />

      <section
        className={[
          'ui-sheet relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-modal-title"
      >
        <div className="flex justify-center pt-3">
          <span className="ui-sheet-handle" />
        </div>

        <header className="flex items-center justify-between gap-3 px-5 pt-3 pb-2">
          <h2 id="case-modal-title" className="text-xl font-bold tracking-tight text-white">
            {giftCase.name}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="ui-icon-btn disabled:opacity-50"
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
              {(() => {
                const reward = resolveWinnerReward(giftCase.rewards, opening)
                return (
                  <div className="mx-auto mt-4 flex size-28 items-center justify-center overflow-hidden rounded-[22px] border border-white/10 bg-bg-surface p-3">
                    <img
                      src={reward.image}
                      alt=""
                      className={[
                        'object-contain',
                        reward.currency === 'COINS' ? 'h-[55%] w-[55%]' : 'size-full',
                      ].join(' ')}
                    />
                  </div>
                )
              })()}
              <p className="mt-3 text-2xl font-bold text-gold">{opening.prize.name}</p>
              <p className="mt-2 text-sm font-medium text-neon-purple">
                {RARITY_LABELS[opening.prize.rarity]}
              </p>
            </div>
          ) : phase === 'animating' && reelItems.length > 0 ? (
            <div className="py-4">
              <CaseOpeningReel
                key={reelKey}
                items={reelItems}
                winnerIndex={winnerIndex}
                durationMs={CASE_OPENING_DURATION_MS}
                reducedMotion={reducedMotion}
                onComplete={handleReelComplete}
              />
            </div>
          ) : phase === 'requesting' ? (
            <div className="flex flex-col items-center justify-center py-16" role="status">
              <div className="size-10 animate-spin rounded-full border-2 border-neon-purple/30 border-t-neon-purple" />
              <p className="mt-4 text-sm text-muted">Определяем награду...</p>
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

          {!canAfford && !isReferral && phase === 'preview' && (
            <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-muted">
              Нужно ещё {formatBalance(missing)} монет
            </p>
          )}
        </div>

        <div
          className="border-t border-white/[0.08] bg-bg-elevated px-5 pt-3"
          style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom))' }}
        >
          {phase === 'result' ? (
            <button
              type="button"
              onClick={close}
              className="ui-btn-primary w-full py-3.5"
            >
              Отлично
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleOpen()}
              disabled={!canSubmit || busy}
              className="ui-btn-primary w-full py-3.5 disabled:opacity-60"
            >
              {buttonLabel()}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
