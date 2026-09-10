import { useEffect, useMemo, useRef, useState } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import { DailyFreeCaseResultModal } from '@/components/DailyFreeCaseResultModal'
import { DAILY_FREE_CASE_REWARDS, type DailyFreeCaseReward } from '@/data/daily-free-case'
import { useUserAccount } from '@/hooks/useUserAccount'
import { openDailyFreeCase } from '@/lib/daily-free-case'
import {
  buildDailyFreeCaseReel,
  CASE_OPENING_DURATION_MS,
  computeReelTranslateX,
  resolveDailyFreeCaseReward,
  type DailyFreeCaseReelItem,
} from '@/lib/daily-free-case-reel'
import { formatCountdown } from '@/lib/giveaways'
import { createPurchaseRequestId } from '@/lib/shop'

const ITEM_WIDTH = 92
const ITEM_GAP = 10
const TRACK_HEIGHT = 148

type UiPhase = 'idle' | 'requesting' | 'spinning' | 'result' | 'error'

function isAvailable(availableAt: string | null | undefined, nowMs: number): boolean {
  if (!availableAt) {
    return true
  }
  const end = Date.parse(availableAt)
  if (!Number.isFinite(end)) {
    return true
  }
  return nowMs >= end
}

function RewardCard({
  reward,
  highlighted = false,
  dimmed = false,
}: {
  reward: DailyFreeCaseReward
  highlighted?: boolean
  dimmed?: boolean
}) {
  return (
    <article
      className={[
        'flex shrink-0 flex-col overflow-hidden rounded-[18px] border',
        'bg-[linear-gradient(180deg,#1c1528_0%,#121018_100%)]',
        highlighted
          ? 'border-neon-purple/55 shadow-[0_0_24px_rgb(168_85_247/35%)] scale-[1.04]'
          : 'border-white/10',
        dimmed ? 'opacity-45' : 'opacity-100',
        'transition-[transform,opacity,box-shadow] duration-300',
      ].join(' ')}
      style={{ width: ITEM_WIDTH, height: 124 }}
    >
      <div className="flex flex-1 items-center justify-center">
        <span className="text-[34px] leading-none" aria-hidden>
          {reward.emoji}
        </span>
      </div>
      <div className="border-t border-white/5 px-1.5 py-1.5 text-center">
        <p className="truncate text-[10px] font-semibold leading-tight text-white/90">
          {reward.name}
        </p>
        <p className="mt-0.5 inline-flex items-center justify-center gap-0.5 text-[10px] font-semibold text-gold">
          <CoinIcon className="size-3" />
          {new Intl.NumberFormat('ru-RU').format(reward.amount)}
        </p>
      </div>
    </article>
  )
}

export function DailyFreeCase() {
  const account = useUserAccount()
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [phase, setPhase] = useState<UiPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [availableAt, setAvailableAt] = useState<string | null>(
    account.dailyFreeCaseAvailableAt ?? null,
  )
  const [reel, setReel] = useState<{
    items: DailyFreeCaseReelItem[]
    winnerIndex: number
  } | null>(null)
  const [winner, setWinner] = useState<DailyFreeCaseReward | null>(null)
  const [highlighted, setHighlighted] = useState(false)
  const [dims, setDims] = useState<{ width: number } | null>(null)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const inFlightRef = useRef(false)
  const requestIdRef = useRef<string | null>(null)

  const previewItems = useMemo(() => {
    const loop = [...DAILY_FREE_CASE_REWARDS, ...DAILY_FREE_CASE_REWARDS]
    return loop.slice(0, 8)
  }, [])

  useEffect(() => {
    setAvailableAt(account.dailyFreeCaseAvailableAt ?? null)
  }, [account.dailyFreeCaseAvailableAt])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const measure = () => setDims({ width: viewport.clientWidth })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [phase, reel])

  const available =
    phase !== 'spinning' &&
    phase !== 'requesting' &&
    phase !== 'result' &&
    isAvailable(availableAt, nowMs)
  const busy = phase === 'requesting' || phase === 'spinning'

  useEffect(() => {
    if (phase !== 'spinning' || !reel || !dims) {
      return
    }

    const track = trackRef.current
    if (!track) {
      return
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const finalX = computeReelTranslateX({
      containerWidth: dims.width,
      itemWidth: ITEM_WIDTH,
      gap: ITEM_GAP,
      winnerIndex: reel.winnerIndex,
    })

    let cancelled = false
    let bounce: Animation | null = null
    let resultTimer: number | null = null

    if (reducedMotion) {
      track.style.transform = `translate3d(${finalX}px, 0, 0)`
      setHighlighted(true)
      resultTimer = window.setTimeout(() => {
        if (!cancelled) {
          setPhase('result')
        }
      }, 350)
      return () => {
        cancelled = true
        if (resultTimer != null) {
          window.clearTimeout(resultTimer)
        }
      }
    }

    track.style.transform = 'translate3d(0px, 0, 0)'
    const main = track.animate(
      [
        { transform: 'translate3d(0px, 0, 0)' },
        { transform: `translate3d(${finalX}px, 0, 0)` },
      ],
      {
        duration: CASE_OPENING_DURATION_MS,
        easing: 'cubic-bezier(0.05, 0.75, 0.05, 1)',
        fill: 'forwards',
      },
    )

    void main.finished
      .then(() => {
        if (cancelled) {
          return
        }
        setHighlighted(true)
        bounce = track.animate(
          [
            { transform: `translate3d(${finalX}px, 0, 0)` },
            { transform: `translate3d(${finalX + 6}px, 0, 0)` },
            { transform: `translate3d(${finalX - 3}px, 0, 0)` },
            { transform: `translate3d(${finalX}px, 0, 0)` },
          ],
          { duration: 320, easing: 'ease-out', fill: 'forwards' },
        )
        return bounce.finished
      })
      .then(() => {
        if (cancelled) {
          return
        }
        resultTimer = window.setTimeout(() => setPhase('result'), 450)
      })
      .catch(() => {
        // cancelled
      })

    return () => {
      cancelled = true
      main.cancel()
      bounce?.cancel()
      if (resultTimer != null) {
        window.clearTimeout(resultTimer)
      }
    }
  }, [dims, phase, reel])

  async function handleOpen() {
    if (inFlightRef.current || !available) {
      return
    }
    inFlightRef.current = true
    setError(null)
    setHighlighted(false)
    setPhase('requesting')

    const requestId = createPurchaseRequestId()
    requestIdRef.current = requestId

    const result = await openDailyFreeCase(requestId)
    if (!result.success || !result.reward) {
      setError(result.message || 'Не удалось открыть кейс.')
      if (result.availableAt) {
        setAvailableAt(result.availableAt)
      }
      setPhase('error')
      inFlightRef.current = false
      return
    }

    const resolved = resolveDailyFreeCaseReward(result.reward)
    setWinner(resolved)
    setAvailableAt(result.availableAt ?? null)
    setReel(buildDailyFreeCaseReel(resolved))
    setPhase('spinning')
  }

  function handleCloseResult() {
    setPhase('idle')
    setReel(null)
    setWinner(null)
    setHighlighted(false)
    inFlightRef.current = false
    requestIdRef.current = null
  }

  const showSpinTrack = phase === 'spinning' && reel
  const cooldownLabel =
    availableAt && !isAvailable(availableAt, nowMs)
      ? formatCountdown(availableAt, nowMs)
      : null

  return (
    <section className="w-full" aria-label="Бесплатный ежедневный кейс">
      <div
        className={[
          'relative overflow-hidden rounded-[22px] border border-neon-purple/30',
          'bg-[radial-gradient(ellipse_at_20%_0%,rgb(168_85_247/16%),transparent_55%),linear-gradient(180deg,#15101f_0%,#0d0b14_100%)]',
          'shadow-[0_0_28px_rgb(168_85_247/12%)]',
        ].join(' ')}
      >
        <div
          ref={viewportRef}
          className="relative overflow-hidden"
          style={{ height: TRACK_HEIGHT }}
        >
          <div
            className="pointer-events-none absolute top-1 left-1/2 z-20 -translate-x-1/2"
            aria-hidden
          >
            <span className="block border-x-[7px] border-t-[10px] border-x-transparent border-t-[#a855f7]" />
          </div>
          <div
            className="pointer-events-none absolute bottom-1 left-1/2 z-20 -translate-x-1/2"
            aria-hidden
          >
            <span className="block border-x-[7px] border-b-[10px] border-x-transparent border-b-[#a855f7]" />
          </div>
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[#0d0b14] to-transparent"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[#0d0b14] to-transparent"
            aria-hidden
          />

          {showSpinTrack ? (
            <div
              ref={trackRef}
              className="absolute top-1/2 left-0 flex -translate-y-1/2 will-change-transform"
              style={{ gap: ITEM_GAP }}
            >
              {reel.items.map((item, index) => (
                <RewardCard
                  key={item.key}
                  reward={item.reward}
                  highlighted={highlighted && index === reel.winnerIndex}
                  dimmed={highlighted && index !== reel.winnerIndex}
                />
              ))}
            </div>
          ) : (
            <div
              className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2"
              style={{ gap: ITEM_GAP }}
            >
              {previewItems.map((reward, index) => (
                <RewardCard key={`${reward.id}-preview-${index}`} reward={reward} />
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          void handleOpen()
        }}
        disabled={!available || busy}
        className={[
          'mt-3 flex min-h-[52px] w-full items-center justify-center rounded-full',
          'text-[15px] font-extrabold tracking-wide',
          'transition-transform duration-150 active:scale-[0.98]',
          available && !busy
            ? 'bg-gradient-to-r from-[#fff6c8] via-[#ffd84a] to-[#f0a512] text-[#1a1200] shadow-[0_8px_28px_rgb(244_201_93/35%)]'
            : 'cursor-not-allowed bg-white/10 text-white/45',
        ].join(' ')}
      >
        {busy
          ? 'Открываем…'
          : cooldownLabel
            ? `Следующий кейс через ${cooldownLabel}`
            : '🔥 БЕСПЛАТНО'}
      </button>

      <p className="mt-2.5 text-center text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">
        Вы можете выиграть
      </p>

      {error && phase === 'error' ? (
        <p className="mt-2 text-center text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {phase === 'result' && winner ? (
        <DailyFreeCaseResultModal reward={winner} onClose={handleCloseResult} />
      ) : null}
    </section>
  )
}
