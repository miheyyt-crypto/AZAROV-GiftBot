import { formatBalance } from '@/lib/balance'
import { formatRollUser, type RollGameCard } from '@/types/roll'

type RollStatsCardsProps = {
  previousGame: RollGameCard | null
  topGame: RollGameCard | null
}

function StatCard({
  label,
  card,
  accentClass,
}: {
  label: string
  card: RollGameCard | null
  accentClass: string
}) {
  return (
    <div className="min-w-0 flex-1 rounded-[16px] border border-white/10 bg-[#14101c]/95 px-3 py-2.5 shadow-[0_4px_16px_rgb(0_0_0/25%)]">
      <p className="text-[10px] font-bold uppercase tracking-wide text-white/45">{label}</p>
      {card ? (
        <div className="mt-1.5 flex items-center gap-2">
          {card.winnerPhotoUrl ? (
            <img
              src={card.winnerPhotoUrl}
              alt=""
              className="size-8 shrink-0 rounded-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white/70">
              {(card.winnerUsername || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-white">
              {formatRollUser({ username: card.winnerUsername })}
            </p>
            <p className="text-[11px] tabular-nums text-[#7dd3fc]">
              {Number(card.winnerChance || 0).toFixed(0)}%
            </p>
          </div>
          <p className={`shrink-0 text-[12px] font-bold tabular-nums ${accentClass}`}>
            +{formatBalance(card.winnings)}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-white/35">Пока нет</p>
      )}
    </div>
  )
}

export function RollStatsCards({ previousGame, topGame }: RollStatsCardsProps) {
  return (
    <div className="mb-3 flex gap-2.5">
      <StatCard label="Пред. игра" card={previousGame} accentClass="text-[#7dd3fc]" />
      <StatCard label="Топ игра" card={topGame} accentClass="text-[#f0c14b]" />
    </div>
  )
}
