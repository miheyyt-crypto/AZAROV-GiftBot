import { ArrowLeft, Gift, Trophy, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  formatCountdown,
  formatParticipantsLabel,
  formatPrizeLabel,
  formatWinnersLabel,
  getGiveaway,
  participateGiveaway,
} from '@/lib/giveaways'
import { ROUTES } from '@/lib/constants'
import type { Giveaway } from '@/types/giveaway'

function winnerLabel(winner: NonNullable<Giveaway['winners']>[number]): string {
  if (winner.username) {
    return `@${winner.username}`
  }
  if (winner.firstName) {
    return winner.firstName
  }
  return 'Участник'
}

export function GiveawayDetail() {
  const { giveawayId = '' } = useParams()
  const navigate = useNavigate()
  const [giveaway, setGiveaway] = useState<Giveaway | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [actionMessage, setActionMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      const result = await getGiveaway(giveawayId)
      if (cancelled) {
        return
      }
      if (!result.success || !result.giveaway) {
        setGiveaway(null)
        setError(result.message || 'Розыгрыш не найден.')
        setLoading(false)
        return
      }
      setGiveaway(result.giveaway)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [giveawayId])

  useEffect(() => {
    if (!giveaway || giveaway.status !== 'active') {
      return
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [giveaway])

  async function handleParticipate() {
    if (!giveaway || busy || giveaway.isParticipating || giveaway.status !== 'active') {
      return
    }
    setBusy(true)
    setActionMessage('')
    const result = await participateGiveaway(giveaway.id)
    setBusy(false)
    if (!result.success) {
      setActionMessage(result.message || 'Не удалось участвовать.')
      return
    }
    if (result.giveaway) {
      setGiveaway(result.giveaway)
    } else {
      setGiveaway((current) =>
        current
          ? {
              ...current,
              isParticipating: true,
              participantsCount: result.participantsCount ?? current.participantsCount,
            }
          : current,
      )
    }
    setActionMessage(
      result.alreadyParticipating ? 'Вы уже участвуете.' : 'Вы участвуете в розыгрыше!',
    )
  }

  if (loading) {
    return (
      <div className="ui-page">
        <div className="h-48 animate-pulse rounded-2xl bg-white/[0.04]" />
        <div className="mt-4 h-6 w-2/3 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-3 h-20 animate-pulse rounded-2xl bg-white/[0.04]" />
      </div>
    )
  }

  if (!giveaway) {
    return (
      <div className="ui-page">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-2 text-sm text-muted"
        >
          <ArrowLeft size={16} aria-hidden />
          Назад
        </button>
        <p className="text-white">{error || 'Розыгрыш не найден.'}</p>
        <Link to={ROUTES.giveaways} className="mt-4 inline-block text-sm text-kick">
          К розыгрышам
        </Link>
      </div>
    )
  }

  const isActive = giveaway.status === 'active'
  const participating = Boolean(giveaway.isParticipating)

  return (
    <div className="ui-page">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted"
      >
        <ArrowLeft size={16} aria-hidden />
        Назад
      </button>

      <article className="overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#141218]/95">
        <div className="aspect-[16/10] w-full overflow-hidden bg-black/40">
          <img src={giveaway.image} alt="" className="size-full object-cover" />
        </div>

        <div className="space-y-4 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-kick">
              {isActive ? '🎁 Активный розыгрыш' : '🎉 Розыгрыш завершён'}
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-white">{giveaway.title}</h1>
            {giveaway.description ? (
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{giveaway.description}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[11px] text-muted">Приз</p>
              <p className="mt-1 break-words text-sm font-semibold text-white">
                {formatPrizeLabel(giveaway)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[11px] text-muted">Победители</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-white">
                <Trophy size={14} className="text-kick" aria-hidden />
                {formatWinnersLabel(giveaway.winnersCount)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[11px] text-muted">Участники</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-white">
                <Users size={14} className="text-kick" aria-hidden />
                {formatParticipantsLabel(giveaway.participantsCount || 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[11px] text-muted">{isActive ? 'До завершения' : 'Завершён'}</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {isActive
                  ? formatCountdown(giveaway.endAt, nowMs)
                  : giveaway.completedAt
                    ? new Date(giveaway.completedAt).toLocaleString('ru-RU')
                    : '—'}
              </p>
            </div>
          </div>

          {isActive ? (
            <button
              type="button"
              disabled={busy || participating}
              onClick={() => void handleParticipate()}
              className={[
                'flex w-full min-h-12 items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-semibold transition-[filter,background-color]',
                participating
                  ? 'border border-kick/35 bg-kick/15 text-kick'
                  : 'bg-kick text-white hover:brightness-110 active:brightness-95 disabled:opacity-60',
              ].join(' ')}
            >
              <Gift size={18} aria-hidden />
              {participating ? 'Вы участвуете ✓' : busy ? 'Запись…' : 'Участвовать'}
            </button>
          ) : (
            <div className="rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-sm font-semibold text-white/85">
              Розыгрыш завершён
            </div>
          )}

          {actionMessage ? (
            <p className="text-center text-xs text-text-secondary">{actionMessage}</p>
          ) : null}

          {!isActive && Array.isArray(giveaway.winners) && giveaway.winners.length > 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3.5">
              <h2 className="text-sm font-bold text-white">🏆 Победители</h2>
              <ul className="mt-3 space-y-2">
                {giveaway.winners.map((winner) => (
                  <li
                    key={winner.userId}
                    className="flex items-center gap-2 rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-kick/15 text-xs font-bold text-kick">
                      {winner.photoUrl ? (
                        <img src={winner.photoUrl} alt="" className="size-full object-cover" />
                      ) : (
                        (winner.firstName || winner.username || '?').slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <span className="truncate text-sm font-medium text-white">
                      {winnerLabel(winner)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  )
}
