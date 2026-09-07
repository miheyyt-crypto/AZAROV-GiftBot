import { useEffect, useState } from 'react'

import { HomeSectionTitle } from '@/components/HomeSectionTitle'
import { fetchLeaderboard, getPlayerInitial } from '@/lib/home'
import { HOME_FEED_POLL_MS } from '@/lib/constants'
import { formatBalance } from '@/lib/balance'
import type { LeaderboardPlayer } from '@/types/home'

const rankStyles = {
  1: {
    ring: 'border-[#f5c842] shadow-[0_0_20px_rgb(245_200_66/35%)]',
    badge: 'bg-[#f5c842] text-[#1a1200]',
    balance: 'text-[#f5c842]',
    pedestal: 'h-[72px] bg-[#f5c842]/10 text-[#f5c842]/25',
    lift: '-translate-y-3',
    avatar: 'size-[68px] text-xl',
  },
  2: {
    ring: 'border-[#b8c0cc] shadow-[0_0_16px_rgb(184_192_204/20%)]',
    badge: 'bg-[#b8c0cc] text-[#141820]',
    balance: 'text-white',
    pedestal: 'h-[52px] bg-white/[0.06] text-white/20',
    lift: '',
    avatar: 'size-[56px] text-lg',
  },
  3: {
    ring: 'border-[#d4845a] shadow-[0_0_16px_rgb(212_132_90/20%)]',
    badge: 'bg-[#d4845a] text-[#1a1008]',
    balance: 'text-[#e8a06a]',
    pedestal: 'h-[52px] bg-[#d4845a]/10 text-[#d4845a]/25',
    lift: '',
    avatar: 'size-[56px] text-lg',
  },
} as const

function PodiumPlayer({ player }: { player: LeaderboardPlayer }) {
  const styles = rankStyles[player.rank as 1 | 2 | 3]
  const initial = getPlayerInitial(player.displayName)

  return (
    <div className="flex flex-1 flex-col items-center">
      <div className={['flex flex-col items-center', styles.lift].join(' ')}>
        <div className="relative mb-2">
          <div
            className={[
              'relative overflow-hidden rounded-full border-[3px]',
              styles.ring,
              styles.avatar,
            ].join(' ')}
          >
            {player.photoUrl ? (
              <img
                src={player.photoUrl}
                alt={player.displayName}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center bg-gradient-to-br from-purple to-neon-purple font-bold text-white">
                {initial}
              </div>
            )}
          </div>
          <span
            className={[
              'absolute -bottom-1 left-1/2 flex size-5 -translate-x-1/2 items-center justify-center rounded-full text-[10px] font-bold',
              styles.badge,
            ].join(' ')}
          >
            {player.rank}
          </span>
        </div>

        <p className="max-w-[92px] truncate text-center text-xs font-medium text-white">
          {player.displayName}
        </p>
        <p className={['mt-1 flex items-center gap-1 text-sm font-bold', styles.balance].join(' ')}>
          <span aria-hidden>🪙</span>
          {formatBalance(player.balance)}
        </p>
      </div>

      <div
        className={[
          'mt-3 flex w-full items-end justify-center rounded-t-2xl text-4xl font-black',
          styles.pedestal,
        ].join(' ')}
      >
        {player.rank}
      </div>
    </div>
  )
}

export function LeaderboardPodium() {
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const list = await fetchLeaderboard()
      if (cancelled || list === null) {
        return
      }

      setPlayers(list.slice(0, 3))
      setIsLoading(false)
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, HOME_FEED_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const ordered = [
    players.find((item) => item.rank === 2),
    players.find((item) => item.rank === 1),
    players.find((item) => item.rank === 3),
  ].filter(Boolean) as LeaderboardPlayer[]

  return (
    <section className="mb-6">
      <HomeSectionTitle title="Топ лудиков" />

      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-gradient-to-b from-white/[0.04] to-bg-surface/80 px-3 pb-0 pt-5 backdrop-blur-md">
        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted">Загружаем топ...</p>
        ) : ordered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Пока нет игроков в топе</p>
        ) : (
          <div className="flex items-end justify-center gap-2">
            {ordered.map((player) => (
              <PodiumPlayer key={player.rank} player={player} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
