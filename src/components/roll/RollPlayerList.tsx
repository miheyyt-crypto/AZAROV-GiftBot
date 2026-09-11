import { CoinIcon } from '@/components/CoinIcon'
import { formatBalance } from '@/lib/balance'
import { formatRollUser, type RollRound } from '@/types/roll'

type RollPlayerListProps = {
  round: RollRound | null
}

export function RollPlayerList({ round }: RollPlayerListProps) {
  const players = round?.players || []
  const count = players.length
  const max = round?.maxPlayers || 2

  return (
    <section className="rounded-[20px] border border-white/[0.08] bg-[#120e1a]/95 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[14px] font-bold text-white">
          {count} {count === 1 ? 'Игрок' : 'Игрока'}
          {count < max ? (
            <span className="ml-1 font-medium text-white/40">/ {max}</span>
          ) : null}
        </p>
        <p className="text-[12px] text-white/40">Игра #{round?.displayId ?? '—'}</p>
      </div>

      {players.length === 0 ? (
        <p className="py-3 text-center text-[13px] text-white/40">Ожидаем игроков...</p>
      ) : (
        <ul className="space-y-2">
          {players.map((player) => (
            <li
              key={player.userId}
              className="flex items-center gap-3 rounded-[16px] border border-white/[0.06] bg-[#181322] px-3 py-2.5"
            >
              {player.photoUrl ? (
                <img
                  src={player.photoUrl}
                  alt=""
                  className="size-10 shrink-0 rounded-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white/70">
                  {formatRollUser(player).slice(1, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-white">
                  {formatRollUser(player)}
                </p>
                <p className="text-[12px] font-semibold tabular-nums text-[#7dd3fc]">
                  {player.chance.toFixed(2)}%
                </p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-full border border-[rgb(79_195_247/35%)] bg-[rgb(79_195_247/12%)] px-2.5 py-1 text-[12px] font-bold text-[#7dd3fc]">
                <CoinIcon className="size-3.5" />
                <span className="tabular-nums">{formatBalance(player.bet)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
