import { useEffect, useMemo, useRef, useState } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import { formatBalance } from '@/lib/balance'
import { formatPlayersCountLabel, formatRollUser, type RollRound } from '@/types/roll'

type RollPlayerListProps = {
  round: RollRound | null
}

const ROW_H = 62
const MAX_VISIBLE_ROWS = 8
const VIRTUALIZE_FROM = 40

export function RollPlayerList({ round }: RollPlayerListProps) {
  const players = round?.players || []
  const count = players.length
  const max = round?.maxPlayers || 1000
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const virtualized = count >= VIRTUALIZE_FROM
  const viewportH = Math.min(count, MAX_VISIBLE_ROWS) * ROW_H

  const { start, end, offsetY } = useMemo(() => {
    if (!virtualized) {
      return { start: 0, end: count, offsetY: 0 }
    }
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - 2)
    const visible = Math.ceil(viewportH / ROW_H) + 4
    const endIdx = Math.min(count, startIdx + visible)
    return { start: startIdx, end: endIdx, offsetY: startIdx * ROW_H }
  }, [virtualized, scrollTop, count, viewportH])

  useEffect(() => {
    setScrollTop(0)
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [round?.id])

  const slice = virtualized ? players.slice(start, end) : players

  return (
    <section className="rounded-[20px] border border-white/[0.08] bg-[#120e1a]/95 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[14px] font-bold text-white">
          {formatPlayersCountLabel(count)}
          {count < max ? (
            <span className="ml-1 font-medium text-white/40">/ {max}</span>
          ) : null}
        </p>
        <p className="text-[12px] text-white/40">Игра #{round?.displayId ?? '—'}</p>
      </div>

      {players.length === 0 ? (
        <p className="py-3 text-center text-[13px] text-white/40">Ожидаем игроков...</p>
      ) : virtualized ? (
        <div
          ref={scrollRef}
          className="overflow-y-auto overscroll-contain"
          style={{ maxHeight: viewportH }}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        >
          <ul className="relative" style={{ height: count * ROW_H }}>
            <div className="absolute left-0 right-0 space-y-2" style={{ top: offsetY }}>
              {slice.map((player) => (
                <PlayerRow key={player.userId} player={player} />
              ))}
            </div>
          </ul>
        </div>
      ) : (
        <ul className="space-y-2">
          {slice.map((player) => (
            <PlayerRow key={player.userId} player={player} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PlayerRow({
  player,
}: {
  player: {
    userId: number
    username: string
    firstName: string
    photoUrl: string
    bet: number
    chance: number
  }
}) {
  return (
    <li className="flex h-[54px] items-center gap-3 rounded-[16px] border border-white/[0.06] bg-[#181322] px-3 py-2.5">
      {player.photoUrl ? (
        <img
          src={player.photoUrl}
          alt=""
          className="size-10 shrink-0 rounded-full object-cover"
          draggable={false}
          loading="lazy"
        />
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white/70">
          {formatRollUser(player).slice(1, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-white">{formatRollUser(player)}</p>
        <p className="text-[12px] font-semibold tabular-nums text-[#7dd3fc]">
          {player.chance.toFixed(2)}%
        </p>
      </div>
      <div className="inline-flex items-center gap-1 rounded-full border border-[rgb(79_195_247/35%)] bg-[rgb(79_195_247/12%)] px-2.5 py-1 text-[12px] font-bold text-[#7dd3fc]">
        <CoinIcon className="size-3.5" />
        <span className="tabular-nums">{formatBalance(player.bet)}</span>
      </div>
    </li>
  )
}
