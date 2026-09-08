import { useEffect, useRef, useState } from 'react'

import {
  CASE_OPENING_BOUNCE_PX,
  CASE_OPENING_DURATION_MS,
  CASE_OPENING_RESULT_DELAY_MS,
  computeReelTranslateX,
  type CaseReelItem,
} from '@/lib/case-opening-reel'
import { RARITY_LABELS, type CaseRewardRarity } from '@/types/case'

const ITEM_WIDTH_PX = 96
const ITEM_GAP_PX = 10

const rarityBorder: Record<CaseRewardRarity, string> = {
  legendary: 'border-gold/55 bg-gold/10',
  epic: 'border-neon-purple/45 bg-neon-purple/10',
  rare: 'border-sky-400/45 bg-sky-400/10',
  common: 'border-white/12 bg-white/[0.04]',
}

const rarityGlow: Record<CaseRewardRarity, string> = {
  legendary: 'shadow-[0_0_28px_rgb(251_191_36/45%)]',
  epic: 'shadow-[0_0_28px_rgb(168_85_247/40%)]',
  rare: 'shadow-[0_0_24px_rgb(56_189_248/35%)]',
  common: 'shadow-[0_0_18px_rgb(255_255_255/12%)]',
}

interface CaseOpeningReelProps {
  items: CaseReelItem[]
  winnerIndex: number
  durationMs?: number
  reducedMotion?: boolean
  onComplete: () => void
}

export function CaseOpeningReel({
  items,
  winnerIndex,
  durationMs = CASE_OPENING_DURATION_MS,
  reducedMotion = false,
  onComplete,
}: CaseOpeningReelProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const completedRef = useRef(false)
  const [highlighted, setHighlighted] = useState(false)
  const [dims, setDims] = useState<{ containerWidth: number } | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    const measure = () => {
      setDims({ containerWidth: viewport.clientWidth })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    completedRef.current = false
    setHighlighted(false)

    const track = trackRef.current
    const viewport = viewportRef.current
    if (!track || !viewport || !dims) {
      return
    }

    const finish = () => {
      if (completedRef.current) {
        return
      }
      completedRef.current = true
      onComplete()
    }

    const finalX = computeReelTranslateX({
      containerWidth: dims.containerWidth,
      itemWidth: ITEM_WIDTH_PX,
      gap: ITEM_GAP_PX,
      winnerIndex,
    })

    if (reducedMotion) {
      track.style.transform = `translate3d(${finalX}px, 0, 0)`
      setHighlighted(true)
      const timer = window.setTimeout(finish, CASE_OPENING_RESULT_DELAY_MS)
      return () => window.clearTimeout(timer)
    }

    track.style.transform = 'translate3d(0px, 0, 0)'

    const main = track.animate(
      [
        { transform: 'translate3d(0px, 0, 0)' },
        { transform: `translate3d(${finalX}px, 0, 0)` },
      ],
      {
        duration: durationMs,
        easing: 'cubic-bezier(0.05, 0.75, 0.05, 1)',
        fill: 'forwards',
      },
    )

    let bounce: Animation | null = null
    let resultTimer: number | null = null
    let cancelled = false

    void main.finished
      .then(() => {
        if (cancelled) {
          return
        }
        setHighlighted(true)
        bounce = track.animate(
          [
            { transform: `translate3d(${finalX}px, 0, 0)` },
            { transform: `translate3d(${finalX + CASE_OPENING_BOUNCE_PX}px, 0, 0)` },
            { transform: `translate3d(${finalX - CASE_OPENING_BOUNCE_PX / 2}px, 0, 0)` },
            { transform: `translate3d(${finalX}px, 0, 0)` },
          ],
          {
            duration: 320,
            easing: 'ease-out',
            fill: 'forwards',
          },
        )
        return bounce.finished
      })
      .then(() => {
        if (cancelled) {
          return
        }
        resultTimer = window.setTimeout(finish, CASE_OPENING_RESULT_DELAY_MS)
      })
      .catch(() => {
        // Animation cancelled on unmount — ignore.
      })

    return () => {
      cancelled = true
      main.cancel()
      bounce?.cancel()
      if (resultTimer != null) {
        window.clearTimeout(resultTimer)
      }
    }
  }, [dims, durationMs, onComplete, reducedMotion, winnerIndex, items])

  return (
    <div className="relative w-full select-none" aria-label="Открытие кейса" role="status">
      <div className="mb-3 text-center">
        <p className="text-sm font-semibold text-white">Открытие кейса</p>
        <p className="mt-1 text-xs text-muted">
          {highlighted ? 'Стоп!' : 'Крутим барабан...'}
        </p>
      </div>

      <div
        ref={viewportRef}
        className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[#121018]"
        style={{ height: 148 }}
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 z-20 w-0.5 -translate-x-1/2 bg-gold"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2 text-gold"
          aria-hidden
        >
          ▼
        </div>
        <div
          className="pointer-events-none absolute bottom-1 left-1/2 z-20 -translate-x-1/2 rotate-180 text-gold"
          aria-hidden
        >
          ▼
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-[#121018] to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-[#121018] to-transparent"
          aria-hidden
        />

        <div
          ref={trackRef}
          className="absolute top-1/2 left-0 flex -translate-y-1/2 will-change-transform"
          style={{ gap: ITEM_GAP_PX }}
        >
          {items.map((item, index) => {
            const isWinnerSlot = index === winnerIndex
            const showWin = isWinnerSlot && highlighted
            return (
              <article
                key={item.key}
                className={[
                  'flex shrink-0 flex-col overflow-hidden rounded-[16px] border transition-[transform,opacity,box-shadow] duration-300',
                  rarityBorder[item.reward.rarity],
                  showWin ? rarityGlow[item.reward.rarity] : '',
                  showWin ? 'scale-[1.06] opacity-100' : highlighted ? 'opacity-45' : 'opacity-100',
                ].join(' ')}
                style={{ width: ITEM_WIDTH_PX, height: 124 }}
                data-winner={isWinnerSlot ? 'true' : undefined}
              >
                <div className="flex flex-1 items-center justify-center overflow-hidden p-1.5">
                  <img
                    src={item.reward.image}
                    alt=""
                    className={[
                      'object-contain',
                      item.reward.currency === 'COINS' ? 'h-[52%] w-[52%]' : 'h-full w-full',
                    ].join(' ')}
                    draggable={false}
                  />
                </div>
                <div className="border-t border-white/5 px-1.5 py-1">
                  <p className="truncate text-[10px] font-semibold leading-tight text-white">
                    {item.reward.name}
                  </p>
                  <p className="truncate text-[9px] text-muted">
                    {RARITY_LABELS[item.reward.rarity]}
                  </p>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
