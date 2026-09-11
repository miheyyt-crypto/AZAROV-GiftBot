import { ChevronDown, Flame, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { useAuth } from '@/components/AuthGate'
import { CoinIcon } from '@/components/CoinIcon'
import { useNotifications } from '@/components/NotificationProvider'
import { PageHeader } from '@/components/PageHeader'
import { useUserAccount } from '@/hooks/useUserAccount'
import { useReferralContestVisible } from '@/hooks/useReferralContestAccess'
import { HOME_FEED_POLL_MS, ROUTES } from '@/lib/constants'
import {
  fetchReferralContest,
  formatCoinsAmount,
  formatContestCountdown,
} from '@/lib/referral-contest'
import { buildReferralLink, shareReferralLink } from '@/lib/referral'
import type {
  ReferralContestMotivation,
  ReferralContestPayload,
  ReferralContestPlayer,
  ReferralContestReferral,
} from '@/types/referral-contest'

type ReferralFilter = 'all' | 'kick' | 'no_kick'

function playerLabel(player: ReferralContestPlayer): string {
  if (player.username) {
    return `@${player.username}`
  }
  return player.displayName || 'Игрок'
}

function referralLabel(item: ReferralContestReferral): string {
  if (item.username) {
    return `@${item.username}`
  }
  return item.displayName || `ID ${item.referredUserId}`
}

function medal(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return `#${rank}`
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.08]">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#f4c95d] to-[#8b5cf6] transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function MotivationBlock({
  motivation,
  meRank,
  meScore,
}: {
  motivation: ReferralContestMotivation
  meRank: number | null
  meScore: number
}) {
  if (motivation.kind === 'leader') {
    return (
      <section className="rounded-[22px] border border-[rgb(244_201_93/40%)] bg-[linear-gradient(165deg,#2a1f0a,#141018)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold">👑 ТЫ ЛИДЕР</p>
        <p className="mt-2 text-lg font-bold text-white">Ты сейчас #1</p>
        <p className="mt-1 flex items-center gap-1.5 text-2xl font-black text-gold-bright">
          <CoinIcon className="size-6" />
          {formatCoinsAmount(motivation.prize || 25_000)}
        </p>
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/80">
          <p className="font-semibold text-white/90">⚠️ Ближайший конкурент</p>
          <p className="mt-1">
            #2 — {motivation.rivalScore ?? 0} реф.
          </p>
          <p>У тебя — {meScore}</p>
          <p className="mt-2 font-bold text-gold">
            Твой отрыв: {motivation.leadBy ?? 0} рефералов
          </p>
          <p className="mt-2 text-xs text-white/55">
            Продолжай приглашать, чтобы сохранить первое место.
          </p>
        </div>
      </section>
    )
  }

  if (motivation.kind === 'start') {
    return (
      <section className="rounded-[22px] border border-kick/30 bg-[linear-gradient(165deg,#14351f,#121018)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-kick-light">
          🚀 НАЧНИ УЧАСТВОВАТЬ
        </p>
        <p className="mt-2 text-sm text-white/80">
          Пригласи первого реферала с привязанным Kick и попади в рейтинг.
        </p>
        <p className="mt-3 text-xs text-white/50">
          Потенциальная награда за TOP-10:{' '}
          <span className="font-semibold text-gold">
            {formatCoinsAmount(motivation.nextPrize || 2_500)}
          </span>
        </p>
      </section>
    )
  }

  if (motivation.kind === 'enter_top') {
    return (
      <section className="rounded-[22px] border border-[rgb(139_92_246/35%)] bg-[linear-gradient(165deg,#1a1430,#121018)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-neon-purple">
          🔥 ДО ПРИЗОВОГО МЕСТА
        </p>
        <p className="mt-2 text-sm text-white/85">
          Ты сейчас #{motivation.currentRank ?? meRank}
        </p>
        <p className="mt-1 text-sm text-white/70">
          #10 — {motivation.targetScore ?? 0} реферала
        </p>
        <p className="text-sm text-white/70">У тебя — {motivation.myScore ?? meScore}</p>
        <p className="mt-3 font-bold text-white">
          Нужно ещё {motivation.needed ?? 0} рефералов с Kick, чтобы войти в TOP-10.
        </p>
        <p className="mt-2 flex items-center gap-1 text-sm text-gold">
          Потенциальная награда: {formatCoinsAmount(motivation.nextPrize || 0)}
          <CoinIcon className="size-3.5" />
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-[22px] border border-[rgb(244_201_93/28%)] bg-[linear-gradient(165deg,#241a10,#121018)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-gold">
        🔥 ДО СЛЕДУЮЩЕГО МЕСТА
      </p>
      <p className="mt-2 text-sm text-white/85">Ты сейчас #{motivation.currentRank ?? meRank}</p>
      <p className="mt-1 text-sm text-white/70">
        Выше тебя: #{motivation.targetRank} — {motivation.targetScore ?? 0} реферала
      </p>
      <p className="text-sm text-white/70">У тебя: {motivation.myScore ?? meScore} рефералов</p>
      <p className="mt-3 font-bold text-white">
        Нужно ещё {motivation.needed ?? 0} рефералов с привязанным Kick.
      </p>
      <p className="mt-2 text-sm text-kick-light">
        ⬆️ Ты займёшь #{motivation.targetRank}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-gold">
        💰 Приз увеличится:{' '}
        {formatCoinsAmount(motivation.currentPrize || 0)} →{' '}
        {formatCoinsAmount(motivation.nextPrize || 0)}
        <CoinIcon className="size-3.5" />
      </p>
    </section>
  )
}

export function ReferralBattlePage() {
  const navigate = useNavigate()
  const { sessionReady } = useAuth()
  const account = useUserAccount()
  const contestVisible = useReferralContestVisible()
  const { showNotification } = useNotifications()

  const [payload, setPayload] = useState<ReferralContestPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [filter, setFilter] = useState<ReferralFilter>('all')
  const [rulesOpen, setRulesOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [countdown, setCountdown] = useState('')

  const load = useCallback(async () => {
    const result = await fetchReferralContest()
    if (!result.success) {
      if (result.code === 'FORBIDDEN' || result.code === 'CONTEST_DISABLED') {
        setForbidden(true)
      }
      setPayload(result)
      setLoading(false)
      return
    }
    setForbidden(false)
    setPayload(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!sessionReady) {
      return
    }
    if (!contestVisible) {
      setForbidden(true)
      setLoading(false)
      return
    }
    void load()
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      void load()
    }, HOME_FEED_POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [contestVisible, load, sessionReady])

  useEffect(() => {
    const endsAt = payload?.contest?.endsAt
    if (!endsAt || payload?.contest?.status === 'ended') {
      setCountdown('')
      return
    }
    const tick = () => setCountdown(formatContestCountdown(endsAt))
    tick()
    const id = window.setInterval(tick, 30_000)
    return () => window.clearInterval(id)
  }, [payload?.contest?.endsAt, payload?.contest?.status])

  const referralLink =
    payload?.referralLink ||
    account.referralLink ||
    buildReferralLink(account.referralCode)

  const referrals = payload?.referrals || []
  const filtered = useMemo(() => {
    if (filter === 'kick') {
      return referrals.filter((item) => item.kickLinked)
    }
    if (filter === 'no_kick') {
      return referrals.filter((item) => !item.kickLinked)
    }
    return referrals
  }, [filter, referrals])

  const me = payload?.me
  const contest = payload?.contest
  const motivation = payload?.motivation
  const ended = contest?.status === 'ended'

  async function handleInvite() {
    if (!referralLink) {
      showNotification({
        type: 'warning',
        title: 'Ссылка недоступна',
        message: 'Открой приложение в Telegram',
      })
      return
    }
    setSharing(true)
    try {
      const result = await shareReferralLink(referralLink)
      if (result === 'copied') {
        showNotification({ type: 'success', title: 'Готово', message: 'Ссылка скопирована' })
      }
    } finally {
      setSharing(false)
    }
  }

  if (!sessionReady || (loading && !payload && !forbidden)) {
    return (
      <div className="ui-page">
        <PageHeader title="Реферальный баттл" showBack backTo={ROUTES.home} />
        <div className="rounded-[22px] border border-white/10 bg-bg-surface p-6 text-center text-sm text-white/60">
          Загрузка конкурса…
        </div>
      </div>
    )
  }

  if (forbidden || !contestVisible) {
    return <Navigate to={ROUTES.home} replace />
  }

  if (!payload?.success || !contest || !me || !motivation) {
    return (
      <div className="ui-page">
        <PageHeader title="Реферальный баттл" showBack backTo={ROUTES.home} />
        <div className="rounded-[22px] border border-danger/30 bg-bg-surface p-6 text-center text-sm text-white/80">
          {payload?.message || 'Не удалось загрузить конкурс.'}
          <button
            type="button"
            className="mt-4 block w-full rounded-xl bg-white/10 py-2.5 font-semibold"
            onClick={() => navigate(ROUTES.home)}
          >
            На главную
          </button>
        </div>
      </div>
    )
  }

  const top3 = payload.top3 || []
  const progressTarget =
    motivation.kind === 'enter_top'
      ? motivation.targetScore || 1
      : motivation.kind === 'climb'
        ? motivation.targetScore || me.score + 1
        : me.score || 1
  const progressNeeded =
    motivation.kind === 'leader' ? 0 : Math.max(0, motivation.needed || 0)

  return (
    <div className="ui-page pb-28">
      <PageHeader title="Реферальный баттл" showBack backTo={ROUTES.home} />

      {/* Hero */}
      <section className="relative overflow-hidden rounded-[26px] border border-[rgb(244_201_93/35%)] bg-[linear-gradient(145deg,#2a1a08_0%,#171221_50%,#0f1420_100%)] p-5 shadow-[0_0_36px_rgb(244_201_93/14%)]">
        <div
          className="pointer-events-none absolute -right-8 -top-10 size-40 rounded-full bg-[rgb(244_201_93/18%)] blur-3xl"
          aria-hidden
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold/80">Event</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-white">
          {ended ? '🏁 РЕФЕРАЛЬНЫЙ БАТТЛ ЗАВЕРШЁН' : `🏆 ${contest.title}`}
        </h2>
        <p className="mt-3 text-xs uppercase tracking-wider text-white/50">Призовой фонд</p>
        <p className="mt-1 flex items-center gap-2 text-3xl font-black text-gold-bright">
          <CoinIcon className="size-7" />
          {formatCoinsAmount(contest.prizePool)}
        </p>
        <p className="mt-3 text-sm text-white/70">
          Приводи рефералов с привязанным Kick и поднимайся в рейтинге.
        </p>
        {ended ? (
          <p className="mt-3 font-semibold text-gold">🏆 КОНКУРС ЗАВЕРШЁН</p>
        ) : countdown ? (
          <p className="mt-3 text-sm text-white/60">⏱ До окончания: {countdown}</p>
        ) : null}
      </section>

      {/* TOP-3 / Winners */}
      <section className="mt-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/70">
          {ended ? '🏆 Победители' : '🏆 Лидеры'}
        </h3>
        <div className="grid gap-2">
          {(ended ? payload.winners || payload.top10 || top3 : top3).map((player) => (
            <div
              key={`${player.rank}-${player.username || player.displayName}`}
              className={[
                'flex items-center gap-3 rounded-2xl border px-3 py-3',
                player.rank === 1
                  ? 'border-[rgb(245_200_66/40%)] bg-[rgb(245_200_66/10%)]'
                  : player.rank === 2
                    ? 'border-white/15 bg-white/[0.05]'
                    : player.rank === 3
                      ? 'border-[rgb(212_132_90/35%)] bg-[rgb(212_132_90/10%)]'
                      : 'border-white/10 bg-bg-surface',
                player.isMe ? 'ring-1 ring-kick/50' : '',
              ].join(' ')}
            >
              <span className="w-8 text-center text-lg">{medal(player.rank)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">
                  {playerLabel(player)}
                  {player.isMe ? ' · ты' : ''}
                </p>
                <p className="text-xs text-white/55">{player.score} реф. с Kick</p>
              </div>
              <p className="flex shrink-0 items-center gap-1 text-sm font-bold text-gold">
                {formatCoinsAmount(player.prize)}
                <CoinIcon className="size-3.5" />
              </p>
            </div>
          ))}
          {top3.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-bg-surface p-4 text-sm text-white/55">
              Пока нет участников с валидными рефералами. Будь первым!
            </p>
          ) : null}
        </div>
      </section>

      {/* My result */}
      <section className="mt-5 rounded-[22px] border border-white/12 bg-bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
          👤 Твой результат
        </p>
        {ended ? (
          <div className="mt-3 space-y-2">
            <p className="text-lg font-bold text-white">
              Место: {me.rank ? `#${me.rank}` : 'вне рейтинга'}
            </p>
            <p className="text-sm text-white/70">Рефералов с Kick: {me.score}</p>
            {me.inTop10 ? (
              <p className="flex items-center gap-1.5 text-xl font-black text-gold-bright">
                🎁 Полученный приз:{' '}
                {formatCoinsAmount(me.prizeAwarded || me.potentialPrize)}
                <CoinIcon className="size-5" />
              </p>
            ) : (
              <p className="text-sm text-white/60">
                К сожалению, в этот раз ты не попал в призовую десятку.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-white/45">Место</p>
              <p className="text-2xl font-black text-white">
                {me.rank ? `#${me.rank}` : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-white/45">С Kick</p>
              <p className="text-2xl font-black text-kick-light">{me.score}</p>
            </div>
            <div>
              <p className="text-[11px] text-white/45">Всего приглашено</p>
              <p className="text-lg font-bold text-white">{me.invitedTotal}</p>
            </div>
            <div>
              <p className="text-[11px] text-white/45">Потенциальный приз</p>
              <p className="flex items-center gap-1 text-lg font-bold text-gold">
                {formatCoinsAmount(me.potentialPrize)}
                <CoinIcon className="size-4" />
              </p>
            </div>
          </div>
        )}

        {!ended && me.inTop10 && !me.isLeader ? (
          <p className="mt-3 rounded-xl border border-gold/25 bg-gold/10 px-3 py-2 text-xs text-gold">
            🏆 ТЫ В TOP-10 · ⚠️ Тебя могут обогнать — продолжай приглашать.
          </p>
        ) : null}
        {!ended && me.participating && !me.inTop10 ? (
          <p className="mt-3 rounded-xl border border-neon-purple/25 bg-neon-purple/10 px-3 py-2 text-xs text-white/75">
            🔥 Ты участвуешь! Позиция #{me.rank}. Держи фокус на ближайшей цели.
          </p>
        ) : null}
      </section>

      {/* Motivation */}
      {!ended ? (
        <div className="mt-5">
          <MotivationBlock motivation={motivation} meRank={me.rank} meScore={me.score} />
        </div>
      ) : null}

      {/* Progress */}
      {!ended && motivation.kind !== 'leader' ? (
        <section className="mt-5 rounded-[22px] border border-white/10 bg-bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
            {me.inTop10 ? '🏆 Ты в TOP-10' : '🎯 До TOP-10'}
          </p>
          <p className="mt-2 text-sm text-white/80">
            {me.score} / {progressTarget}
          </p>
          <div className="mt-2">
            <ProgressBar value={me.score} max={progressTarget} />
          </div>
          <p className="mt-2 text-xs text-white/55">
            {me.inTop10
              ? `До #${motivation.targetRank}: ${progressNeeded} рефералов`
              : `Осталось: ${progressNeeded} рефералов с Kick`}
          </p>
        </section>
      ) : null}

      {/* Stats */}
      <section className="mt-5 rounded-[22px] border border-white/10 bg-bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
          📊 Твоя статистика
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-white/50">Всего</dt>
            <dd className="font-semibold text-white">{me.invitedTotal}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-white/50">С Kick</dt>
            <dd className="font-semibold text-kick-light">{me.kickLinkedCount}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-white/50">Без Kick</dt>
            <dd className="font-semibold text-white">{me.withoutKickCount}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-white/50">Позиция</dt>
            <dd className="font-semibold text-white">{me.rank ? `#${me.rank}` : '—'}</dd>
          </div>
        </dl>
      </section>

      {/* Referrals */}
      <section className="mt-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/70">
          👥 Мои рефералы
        </h3>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {(
            [
              ['all', `Все ${me.invitedTotal}`],
              ['kick', `🎮 Kick ${me.kickLinkedCount}`],
              ['no_kick', `Без Kick ${me.withoutKickCount}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={[
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                filter === key
                  ? 'bg-white text-[#120e1c]'
                  : 'bg-white/10 text-white/70',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-bg-surface p-4 text-sm text-white/55">
              Пока нет рефералов в этом фильтре.
            </p>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-bg-surface px-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{referralLabel(item)}</p>
                  <p className="mt-0.5 text-xs text-white/50">
                    {item.kickLinked ? '🎮 Kick привязан' : '⚪ Kick не привязан'}
                    {item.kickUsername ? ` · ${item.kickUsername}` : ''}
                  </p>
                  {item.createdAt ? (
                    <p className="mt-0.5 text-[11px] text-white/40">
                      📅 {new Date(item.createdAt).toLocaleDateString('ru-RU')}
                    </p>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Prizes */}
      <section className="mt-5 rounded-[22px] border border-white/10 bg-bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/50">🏆 Призы</p>
        <ul className="mt-3 space-y-1.5">
          {contest.prizes.map((prize) => (
            <li
              key={prize.place}
              className={[
                'flex items-center justify-between rounded-xl px-2.5 py-2 text-sm',
                prize.place <= 3 ? 'bg-white/[0.06] font-semibold' : 'text-white/80',
              ].join(' ')}
            >
              <span>
                {prize.place <= 3
                  ? `${medal(prize.place)} ${prize.place} место`
                  : `#${prize.place} место`}
              </span>
              <span className="flex items-center gap-1 text-gold">
                {formatCoinsAmount(prize.amount)}
                <CoinIcon className="size-3.5" />
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center justify-center gap-1 text-sm font-bold text-white/80">
          💰 Общий фонд — {formatCoinsAmount(contest.prizePool)}
          <CoinIcon className="size-3.5" />
        </p>
      </section>

      {/* Rules */}
      <section className="mt-5 overflow-hidden rounded-[22px] border border-white/10 bg-bg-surface">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={() => setRulesOpen((open) => !open)}
        >
          <span className="text-sm font-bold text-white">📜 Условия конкурса</span>
          <ChevronDown
            size={18}
            className={['text-white/50 transition-transform', rulesOpen ? 'rotate-180' : ''].join(
              ' ',
            )}
          />
        </button>
        {rulesOpen ? (
          <ol className="space-y-2 border-t border-white/8 px-4 py-3 text-sm leading-relaxed text-white/70">
            <li>1. Участие принимает любой пользователь, который приглашает рефералов.</li>
            <li>2. В рейтинг засчитываются только рефералы, которые привязали Kick в период конкурса.</li>
            <li>3. Чем больше валидных рефералов — тем выше место в рейтинге.</li>
            <li>4. В конце конкурса первые 10 мест получают призы.</li>
            <li>5. Призы распределяются по позиции на момент окончания конкурса.</li>
            <li>
              6. При равном счёте выше тот, кто раньше достиг текущего количества валидных
              рефералов.
            </li>
          </ol>
        ) : null}
      </section>

      {/* Invite sticky CTA */}
      {!ended ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-30 px-4"
          style={{
            bottom:
              'calc(var(--nav-height, 5.75rem) + var(--safe-area-bottom, 0px) + 1.25rem)',
          }}
        >
          <div className="pointer-events-auto mx-auto flex max-w-lg justify-center">
            <button
              type="button"
              onClick={() => void handleInvite()}
              disabled={sharing}
              className="interactive flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#f4c95d] to-[#e8a84a] py-3.5 text-sm font-black text-[#1a1200] shadow-[0_8px_24px_rgb(244_201_93/35%)]"
            >
              <Flame size={18} />
              ПРИГЛАСИТЬ РЕФЕРАЛОВ
              <Send size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
