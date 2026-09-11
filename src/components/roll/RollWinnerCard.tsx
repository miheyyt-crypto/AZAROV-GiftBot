import { useEffect } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import { formatBalance } from '@/lib/balance'
import { formatRollUser, type RollRound } from '@/types/roll'

type RollWinnerCardProps = {
  round: RollRound
  open: boolean
  onClose: () => void
  /** Fired once when the slide-in animation finishes — start confetti after this. */
  onEntered?: () => void
}

export function RollWinnerCard({ round, open, onClose, onEntered }: RollWinnerCardProps) {
  useEffect(() => {
    if (!open) {
      return
    }
    const timer = window.setTimeout(() => {
      onEntered?.()
    }, 320)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, round.id])

  if (!open || !round.winner) {
    return null
  }

  const chance = Number(round.winnerChance ?? round.winner.chance) || 0
  const payout = Number(round.payout) || 0
  const multiplier = Number(round.multiplier) || 0
  const payoutLabel = formatBalance(payout)

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-[60] px-3 pt-2"
      aria-live="polite"
    >
      {/* Soft dim only behind the card band — does not block wheel interaction below */}
      <div
        className="pointer-events-auto relative mx-auto w-full max-w-[340px] roll-winner-card-enter"
        role="dialog"
        aria-label="Результат раунда"
      >
        <div
          className={[
            'relative overflow-hidden rounded-[22px]',
            'border border-white/[0.1]',
            'bg-[linear-gradient(180deg,rgb(36_28_52/96%)_0%,rgb(18_14_28/98%)_55%,rgb(12_10_20/99%)_100%)]',
            'shadow-[0_16px_48px_rgb(0_0_0/55%),0_0_0_1px_rgb(139_61_255/18%),0_0_48px_rgb(88_40_160/28%)]',
            'backdrop-blur-md',
            'px-4 pb-4 pt-2.5',
          ].join(' ')}
        >
          {/* Drag handle */}
          <div className="mb-2.5 flex items-center justify-center" aria-hidden>
            <div className="h-[4px] w-10 rounded-full bg-white/20" />
          </div>

          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full bg-white/[0.08] text-[15px] leading-none text-white/70 transition active:scale-95"
            aria-label="Закрыть"
          >
            ×
          </button>

          {/* Title — matches reference: Игра #ID */}
          <p className="pr-8 text-center text-[16px] font-bold leading-tight tracking-[-0.01em] text-white">
            Игра #{round.displayId}
          </p>

          {/* Winner row */}
          <div className="mt-3.5 flex items-center gap-2.5">
            {round.winner.photoUrl ? (
              <img
                src={round.winner.photoUrl}
                alt=""
                className="size-10 shrink-0 rounded-full object-cover shadow-[0_2px_8px_rgb(0_0_0/45%)] ring-[1.5px] ring-white/20"
                draggable={false}
                onError={(e) => {
                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  const fallback = e.currentTarget.nextElementSibling
                  if (fallback instanceof HTMLElement) {
                    fallback.classList.remove('hidden')
                  }
                }}
              />
            ) : null}
            <div
              className={[
                'flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white/70 ring-[1.5px] ring-white/20',
                round.winner.photoUrl ? 'hidden' : '',
              ].join(' ')}
            >
              {formatRollUser(round.winner).replace('@', '').slice(0, 1).toUpperCase()}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-tight text-white">
                {formatRollUser(round.winner)}
              </p>
              <p className="mt-0.5 text-[12px] font-medium tabular-nums leading-tight text-white/45">
                {chance.toFixed(2)}%
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p className="inline-flex items-center justify-end gap-1 text-[15px] font-bold tabular-nums leading-tight text-[#4ADE80]">
                <span>+{payoutLabel}</span>
                <CoinIcon className="size-3.5" />
              </p>
              <p className="mt-0.5 text-[12px] font-semibold tabular-nums leading-tight text-white/85">
                x{multiplier.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Reward tile — left aligned like reference */}
          <div className="mt-3.5 inline-flex w-[112px] flex-col items-center rounded-[16px] border border-white/[0.06] bg-[#0c0a12] px-2.5 pb-2.5 pt-3">
            <div className="relative mb-1.5 flex size-[52px] items-center justify-center">
              <div
                className="absolute inset-[-6px] rounded-full bg-[radial-gradient(circle,rgb(79_195_247/45%)_0%,transparent_68%)]"
                aria-hidden
              />
              <div className="relative flex size-[46px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#6ecbff_0%,#1e9ad8_48%,#0b5f9a_100%)] shadow-[0_0_18px_rgb(79_195_247/50%)]">
                <CoinIcon className="size-6" />
              </div>
            </div>
            <p className="text-[12px] font-semibold text-white/90">Монеты</p>
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#1e8fd4] px-2 py-[3px] text-[11px] font-bold text-white shadow-[0_2px_8px_rgb(30_143_212/35%)]">
              <CoinIcon className="size-3" />
              <span className="tabular-nums">{payoutLabel}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mt-4 flex w-full items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,#3a3548_0%,#2a2636_100%)] px-4 py-[13px] text-[15px] font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/8%)] transition active:scale-[0.98]"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  )
}
