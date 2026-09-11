import { CoinIcon } from '@/components/CoinIcon'
import { formatBalance } from '@/lib/balance'
import { formatRollUser, type RollRound } from '@/types/roll'

type RollWinnerCardProps = {
  round: RollRound
  open: boolean
  onClose: () => void
}

export function RollWinnerCard({ round, open, onClose }: RollWinnerCardProps) {
  if (!open || !round.winner) {
    return null
  }

  const chance = round.winnerChance ?? round.winner.chance

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 px-1 pt-1">
      <div
        className={[
          'roll-winner-card-enter pointer-events-auto relative mx-auto max-w-[340px] rounded-[20px] border border-white/12',
          'bg-[#1a1624]/98 px-4 pb-4 pt-3 shadow-[0_12px_40px_rgb(0_0_0/55%)] backdrop-blur-md',
        ].join(' ')}
        role="dialog"
        aria-label="Результат раунда"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="mx-auto h-1 w-10 rounded-full bg-white/20" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full bg-white/10 text-sm text-white/70 active:scale-95"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <p className="text-center text-[15px] font-bold text-white">
          Игра #{round.displayId}
          <span className="font-semibold text-white/50"> • Победитель</span>
        </p>

        <div className="mt-3 flex items-center gap-3">
          {round.winner.photoUrl ? (
            <img
              src={round.winner.photoUrl}
              alt=""
              className="size-11 shrink-0 rounded-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold">
              ?
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-white">
              {formatRollUser(round.winner)}
            </p>
            <p className="text-[12px] font-semibold text-white/45">{chance.toFixed(2)}%</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[15px] font-bold tabular-nums text-[#6CFF9A]">
              +{formatBalance(round.payout)}
            </p>
            <p className="text-[12px] text-white/70">x{(round.multiplier || 0).toFixed(2)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-col items-center rounded-[16px] border border-white/8 bg-[#121018] px-4 py-4">
          <div className="mb-2 flex size-14 items-center justify-center rounded-full bg-[radial-gradient(circle,#4fc3f7_0%,#1e88c8_55%,#0d47a1_100%)] shadow-[0_0_24px_rgb(79_195_247/45%)]">
            <CoinIcon className="size-7" />
          </div>
          <p className="text-[12px] font-semibold text-white/50">Монеты</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[15px] font-bold text-[#7dd3fc]">
            <CoinIcon className="size-4" />
            <span className="tabular-nums">{formatBalance(round.payout)}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-[14px] bg-[linear-gradient(180deg,#3a3548,#2a2636)] px-4 py-3 text-[15px] font-bold text-white active:scale-[0.98]"
        >
          Готово
        </button>
      </div>
    </div>
  )
}
