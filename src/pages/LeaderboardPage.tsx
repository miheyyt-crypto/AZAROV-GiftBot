import { Star, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import { PageHeader } from '@/components/PageHeader'
import { formatBalance } from '@/lib/balance'
import { ROUTES } from '@/lib/constants'
import { fetchLeaderboardBoard, getPlayerInitial } from '@/lib/home'
import type { LeaderboardMetric, LeaderboardPlayer } from '@/types/home'

type BoardTab = LeaderboardMetric | 'bosses'

const TABS: Array<{ id: BoardTab; label: string }> = [
  { id: 'balance', label: 'Баланс' },
  { id: 'referrals', label: 'Реферал' },
  { id: 'bosses', label: 'Боссов' },
]

const rankStyles = {
  1: {
    ring: 'border-[#f5c842]/70 shadow-[0_8px_20px_rgb(0_0_0/25%)]',
    badge: 'bg-[#f5c842] text-[#1a1200]',
    score: 'text-[#f5c842]',
    pedestal: 'h-[72px] bg-[#f5c842]/10 text-[#f5c842]/25',
    lift: '-translate-y-3',
    avatar: 'size-[68px] text-xl',
  },
  2: {
    ring: 'border-[#b8c0cc]/60 shadow-[0_8px_18px_rgb(0_0_0/22%)]',
    badge: 'bg-[#b8c0cc] text-[#141820]',
    score: 'text-white',
    pedestal: 'h-[52px] bg-white/[0.06] text-white/20',
    lift: '',
    avatar: 'size-[56px] text-lg',
  },
  3: {
    ring: 'border-[#d4845a]/60 shadow-[0_8px_18px_rgb(0_0_0/22%)]',
    badge: 'bg-[#d4845a] text-[#1a1008]',
    score: 'text-[#e8a06a]',
    pedestal: 'h-[52px] bg-[#d4845a]/10 text-[#d4845a]/25',
    lift: '',
    avatar: 'size-[56px] text-lg',
  },
} as const

function scoreLabel(player: LeaderboardPlayer, metric: LeaderboardMetric): string {
  if (metric === 'referrals') {
    return formatBalance(player.invitedCount ?? 0)
  }
  return formatBalance(player.balance)
}

function PlayerAvatar({
  player,
  className,
}: {
  player: Pick<LeaderboardPlayer, 'displayName' | 'photoUrl'>
  className: string
}) {
  const initial = getPlayerInitial(player.displayName)
  if (player.photoUrl) {
    return <img src={player.photoUrl} alt="" className={['size-full object-cover', className].join(' ')} />
  }
  return (
    <div
      className={[
        'flex size-full items-center justify-center bg-gradient-to-br from-purple to-neon-purple font-bold text-white',
        className,
      ].join(' ')}
    >
      {initial}
    </div>
  )
}

function PodiumPlayer({
  player,
  metric,
}: {
  player: LeaderboardPlayer
  metric: LeaderboardMetric
}) {
  const styles = rankStyles[player.rank as 1 | 2 | 3]

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
            <PlayerAvatar player={player} className="" />
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
        <p className={['mt-1 flex items-center gap-1 text-sm font-bold', styles.score].join(' ')}>
          {metric === 'referrals' ? (
            <Users size={14} aria-hidden />
          ) : (
            <CoinIcon className="size-3.5" />
          )}
          {scoreLabel(player, metric)}
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

function LeaderboardRow({
  player,
  metric,
}: {
  player: LeaderboardPlayer
  metric: LeaderboardMetric
}) {
  return (
    <li
      className={[
        'flex items-center gap-3 border-b border-white/[0.06] px-1 py-3 last:border-b-0',
        player.isMe ? 'rounded-2xl bg-gold/5' : '',
      ].join(' ')}
    >
      <span className="w-7 shrink-0 text-center text-sm font-semibold tabular-nums text-muted">
        {player.rank}
      </span>
      <div className="size-10 shrink-0 overflow-hidden rounded-full border border-white/10">
        <PlayerAvatar player={player} className="" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{player.displayName}</p>
        {typeof player.level === 'number' ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
            <Star size={11} className="text-gold" aria-hidden />
            {player.level}
          </p>
        ) : null}
      </div>
      <p className="inline-flex shrink-0 items-center gap-1 text-sm font-bold tabular-nums text-white">
        {metric === 'referrals' ? (
          <Users size={14} className="text-neon-purple" aria-hidden />
        ) : (
          <CoinIcon className="size-3.5" />
        )}
        {scoreLabel(player, metric)}
      </p>
    </li>
  )
}

function MeStickyBar({
  me,
  metric,
}: {
  me: LeaderboardPlayer
  metric: LeaderboardMetric
}) {
  return (
    <div
      className="pointer-events-none sticky z-20 mx-auto w-full max-w-lg"
      style={{
        bottom: 'calc(var(--nav-height, 5.75rem) + var(--safe-area-bottom, 0px) + 0.35rem)',
      }}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-[22px] border border-gold/55 bg-[#17141c]/95 px-3 py-2.5 shadow-[0_8px_28px_rgb(0_0_0/45%)] backdrop-blur-md">
        <span className="w-10 shrink-0 text-center text-sm font-bold tabular-nums text-gold">
          {me.rank}
        </span>
        <div className="size-9 shrink-0 overflow-hidden rounded-full border border-gold/40">
          <PlayerAvatar player={me} className="" />
        </div>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">Ты</p>
        <p className="inline-flex shrink-0 items-center gap-1 text-sm font-bold tabular-nums text-white">
          {metric === 'referrals' ? (
            <Users size={14} className="text-neon-purple" aria-hidden />
          ) : (
            <CoinIcon className="size-3.5" />
          )}
          {scoreLabel(me, metric)}
        </p>
      </div>
    </div>
  )
}

export function LeaderboardPage() {
  const [tab, setTab] = useState<BoardTab>('balance')
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([])
  const [me, setMe] = useState<LeaderboardPlayer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async (metric: LeaderboardMetric) => {
    setLoading(true)
    setError(false)
    const result = await fetchLeaderboardBoard(metric)
    if (!result) {
      setPlayers([])
      setMe(null)
      setError(true)
      setLoading(false)
      return
    }
    setPlayers(result.players)
    setMe(result.me)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (tab === 'bosses') {
      setLoading(false)
      setError(false)
      return
    }
    void load(tab)
  }, [tab, load])

  const metric: LeaderboardMetric = tab === 'referrals' ? 'referrals' : 'balance'
  const topThree = players.slice(0, 3)
  const rest = players.slice(3)
  const orderedPodium = [
    topThree.find((item) => item.rank === 2),
    topThree.find((item) => item.rank === 1),
    topThree.find((item) => item.rank === 3),
  ].filter(Boolean) as LeaderboardPlayer[]

  return (
    <div className="ui-page">
      <PageHeader title="Лидерборд" showBack backTo={ROUTES.home} />

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-[18px] border border-white/[0.08] bg-white/[0.035] p-1">
        {TABS.map((item) => {
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={[
                'min-h-10 flex-1 rounded-[14px] px-3 text-sm font-bold uppercase tracking-wide transition-all',
                active
                  ? 'bg-neon-purple text-white shadow-[0_0_16px_rgb(168_85_247/35%)]'
                  : 'text-muted',
              ].join(' ')}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {tab === 'bosses' ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.03]">
          <p className="text-2xl font-black uppercase tracking-[0.12em] text-white/80">Скоро...</p>
        </div>
      ) : (
        <>
          <div className="mb-4 overflow-hidden rounded-[24px] border border-white/10 bg-gradient-to-b from-white/[0.04] to-bg-surface/80 px-3 pb-0 pt-5">
            {loading ? (
              <p className="py-10 text-center text-sm text-muted">Загружаем топ...</p>
            ) : error ? (
              <p className="py-10 text-center text-sm text-muted">Не удалось загрузить лидерборд</p>
            ) : orderedPodium.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">Пока нет игроков в топе</p>
            ) : (
              <div className="flex items-end justify-center gap-2">
                {orderedPodium.map((player) => (
                  <PodiumPlayer key={player.rank} player={player} metric={metric} />
                ))}
              </div>
            )}
          </div>

          {!loading && !error && rest.length > 0 ? (
            <ul className="mb-4 rounded-[22px] border border-white/10 bg-white/[0.03] px-3">
              {rest.map((player) => (
                <LeaderboardRow key={`${metric}-${player.rank}`} player={player} metric={metric} />
              ))}
            </ul>
          ) : null}

          {me ? <MeStickyBar me={me} metric={metric} /> : null}
        </>
      )}
    </div>
  )
}
