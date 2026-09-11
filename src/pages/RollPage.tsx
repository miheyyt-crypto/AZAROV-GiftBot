import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CoinIcon } from '@/components/CoinIcon'
import { useNotifications } from '@/components/NotificationProvider'
import { RollPlayerList } from '@/components/roll/RollPlayerList'
import { RollStatsCards } from '@/components/roll/RollStatsCards'
import { RollWheel } from '@/components/roll/RollWheel'
import { useBalance } from '@/hooks/useBalance'
import { useUserAccount } from '@/hooks/useUserAccount'
import { ROUTES } from '@/lib/constants'
import { formatBalance } from '@/lib/balance'
import { fetchRollState, placeRollBet } from '@/lib/roll'
import {
  ROLL_MIN_BET,
  ROLL_POLL_MS_ACTIVE,
  ROLL_POLL_MS_IDLE,
  ROLL_QUICK_BETS,
  formatRollUser,
  type RollConfig,
  type RollGameCard,
  type RollRound,
} from '@/types/roll'

function clampBet(value: number, balance: number, minBet: number): number {
  const maxAffordable = Math.max(0, Math.floor(balance))
  if (maxAffordable < minBet) {
    return minBet
  }
  return Math.min(Math.max(minBet, Math.floor(value)), maxAffordable)
}

export function RollPage() {
  const navigate = useNavigate()
  const { amount, formatted } = useBalance()
  const account = useUserAccount()
  const { showNotification } = useNotifications()

  const [bet, setBet] = useState(ROLL_MIN_BET)
  const [busy, setBusy] = useState(false)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [round, setRound] = useState<RollRound | null>(null)
  const [lastResult, setLastResult] = useState<RollRound | null>(null)
  const [previousGame, setPreviousGame] = useState<RollGameCard | null>(null)
  const [topGame, setTopGame] = useState<RollGameCard | null>(null)
  const [viewerInRound, setViewerInRound] = useState(false)
  const [config, setConfig] = useState<RollConfig | null>(null)
  const [countdownMs, setCountdownMs] = useState<number | null>(null)
  const [spinClock, setSpinClock] = useState<{
    startedAtMs: number
    endsAtMs: number
    targetAngle: number
  } | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)
  const [confettiKey, setConfettiKey] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)

  const skewRef = useRef(0)
  const confettiForRound = useRef<string | null>(null)
  const winToastForRound = useRef<string | null>(null)

  const minBet = config?.minBet ?? ROLL_MIN_BET
  const quickBets = config?.quickBets?.length ? config.quickBets : [...ROLL_QUICK_BETS]

  const canBet =
    !busy &&
    !viewerInRound &&
    round?.status === 'waiting' &&
    (round.players?.length || 0) < (round.maxPlayers || 2) &&
    amount >= minBet &&
    bet >= minBet &&
    bet <= amount

  const applyState = useCallback(
    (payload: Awaited<ReturnType<typeof fetchRollState>>) => {
      if (!payload.success && !payload.round) {
        return
      }
      const clientNow = Date.now()
      if (typeof payload.serverNowMs === 'number') {
        skewRef.current = payload.serverNowMs - clientNow
      } else if (payload.serverNow) {
        skewRef.current = Date.parse(payload.serverNow) - clientNow
      }

      setRound(payload.round)
      setLastResult(payload.lastResult)
      setPreviousGame(payload.previousGame)
      setTopGame(payload.topGame)
      setViewerInRound(Boolean(payload.viewerInRound))
      if (payload.config) {
        setConfig(payload.config)
      }

      const r = payload.round
      if (r?.status === 'betting' && r.bettingEndsAt) {
        const ends = Date.parse(r.bettingEndsAt)
        const remaining = ends - (Date.now() + skewRef.current)
        setCountdownMs(Math.max(0, remaining))
      } else {
        setCountdownMs(null)
      }

      if (r?.status === 'spinning' && r.spinStartedAt && r.spinEndsAt && r.targetAngle != null) {
        const startedAtMs = Date.parse(r.spinStartedAt) - skewRef.current
        const endsAtMs = Date.parse(r.spinEndsAt) - skewRef.current
        setSpinClock({
          startedAtMs,
          endsAtMs,
          targetAngle: Number(r.targetAngle),
        })
      } else if (r?.status === 'completed' && r.targetAngle != null) {
        setSpinClock(null)
      } else if (r?.status === 'waiting' || r?.status === 'betting') {
        setSpinClock(null)
      }

      const resultRound =
        r?.status === 'completed' || r?.status === 'spinning' ? r : payload.lastResult
      if (resultRound?.status === 'completed') {
        setShowResult(true)
        if (confettiForRound.current !== resultRound.id) {
          confettiForRound.current = resultRound.id
          setConfettiKey(resultRound.id)
          setShowConfetti(true)
        }
        if (
          winToastForRound.current !== resultRound.id &&
          Number(resultRound.winnerUserId) === Number(account.telegramId) &&
          account.telegramId > 0
        ) {
          winToastForRound.current = resultRound.id
          showNotification({
            type: 'reward',
            title: 'Победа в Roll!',
            message: `+${formatBalance(resultRound.payout)} монет`,
          })
        }
      } else if (r?.status === 'waiting' && !payload.lastResult) {
        setShowResult(false)
      } else if (r?.status === 'waiting' || r?.status === 'betting') {
        setShowResult(Boolean(payload.lastResult?.status === 'completed' && r.players.length === 0))
      }
    },
    [account.telegramId, showNotification],
  )

  useEffect(() => {
    let cancelled = false
    void fetchRollState().then((payload) => {
      if (cancelled) {
        return
      }
      applyState(payload)
      setBootstrapped(true)
    })
    return () => {
      cancelled = true
    }
  }, [applyState])

  useEffect(() => {
    if (!bootstrapped) {
      return
    }
    const active =
      round?.status === 'waiting' ||
      round?.status === 'betting' ||
      round?.status === 'locked' ||
      round?.status === 'spinning' ||
      round?.status === 'completed'
    const ms = active ? ROLL_POLL_MS_ACTIVE : ROLL_POLL_MS_IDLE
    const timer = window.setInterval(() => {
      void fetchRollState().then(applyState)
    }, ms)
    return () => window.clearInterval(timer)
  }, [applyState, bootstrapped, round?.status])

  useEffect(() => {
    if (round?.status !== 'betting' || !round.bettingEndsAt) {
      return
    }
    const endsAt = round.bettingEndsAt
    const timer = window.setInterval(() => {
      const ends = Date.parse(endsAt)
      setCountdownMs(Math.max(0, ends - (Date.now() + skewRef.current)))
    }, 200)
    return () => window.clearInterval(timer)
  }, [round?.status, round?.bettingEndsAt])

  useEffect(() => {
    if (round?.status !== 'waiting') {
      return
    }
    setBet((current) => clampBet(current, amount, minBet))
  }, [amount, minBet, round?.status])

  const updateBet = useCallback(
    (next: number) => {
      if (round?.status !== 'waiting' || viewerInRound) {
        return
      }
      setBet(clampBet(next, amount, minBet))
    },
    [amount, minBet, round?.status, viewerInRound],
  )

  async function handleBet() {
    if (!canBet) {
      if (amount < minBet) {
        showNotification({
          type: 'warning',
          title: 'Недостаточно монет',
          message: `Минимальная ставка — ${minBet} монет.`,
        })
      }
      return
    }
    setBusy(true)
    try {
      const result = await placeRollBet({ bet })
      applyState(result)
      if (!result.success) {
        showNotification({
          type: 'warning',
          title: 'Ставка не принята',
          message: result.message || 'Попробуйте ещё раз.',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const resultCard = useMemo(() => {
    if (!showResult) {
      return null
    }
    if (round?.status === 'completed' || round?.status === 'spinning') {
      return round
    }
    return lastResult?.status === 'completed' ? lastResult : null
  }, [lastResult, round, showResult])

  if (!bootstrapped) {
    return (
      <div className="ui-page">
        <div className="h-10 w-40 animate-pulse rounded-xl bg-white/[0.06]" />
        <div className="mt-4 aspect-square animate-pulse rounded-full bg-white/[0.04]" />
      </div>
    )
  }

  return (
    <div className="roll-page ui-page relative pb-8">
      <header className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(ROUTES.home)}
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-[#16121f] text-white/80 transition active:scale-95"
          aria-label="В главное меню"
        >
          <ArrowLeft size={18} aria-hidden />
        </button>
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-xl font-bold text-white">
          <span aria-hidden>🍥</span>
          <span>Roll</span>
        </h1>
        <div
          className="inline-flex items-center gap-1.5 rounded-full border border-gold/35 bg-black/40 px-2.5 py-1.5 text-sm font-semibold text-white"
          aria-label={`Баланс ${formatted}`}
        >
          <CoinIcon className="size-4" />
          <span className="tabular-nums">{formatted}</span>
        </div>
      </header>

      {resultCard?.status === 'completed' && resultCard.winner ? (
        <div className="mb-3">
          <p className="mb-2 text-center text-[13px] font-semibold text-white/70">
            Игра #{resultCard.displayId} • Победитель
          </p>
          <div className="flex items-center gap-3 rounded-[18px] border border-[rgb(79_195_247/30%)] bg-[linear-gradient(120deg,#16122a,#12101c)] px-3.5 py-3 shadow-[0_0_24px_rgb(79_195_247/12%)]">
            {resultCard.winner.photoUrl ? (
              <img
                src={resultCard.winner.photoUrl}
                alt=""
                className="size-12 shrink-0 rounded-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold">
                ?
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-white">
                {formatRollUser(resultCard.winner)}
              </p>
              <p className="text-[12px] font-semibold text-[#7dd3fc]">
                {(resultCard.winnerChance ?? resultCard.winner.chance).toFixed(2)}%
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[15px] font-bold tabular-nums text-[#7dd3fc]">
                +{formatBalance(resultCard.payout)}
              </p>
              <p className="text-[12px] text-white/70">x{(resultCard.multiplier || 0).toFixed(2)}</p>
            </div>
          </div>
        </div>
      ) : (
        <RollStatsCards previousGame={previousGame} topGame={topGame} />
      )}

      <RollWheel
        round={round}
        countdownMs={countdownMs}
        spinClock={spinClock}
        showConfetti={showConfetti && resultCard?.status === 'completed'}
        confettiKey={confettiKey}
      />

      {round?.status === 'waiting' && potLabel(round)}

      {round?.status === 'waiting' && !viewerInRound ? (
        <section className="mb-3 rounded-[20px] border border-white/[0.08] bg-[#120e1a] p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab]">
            Сумма ставки
          </p>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateBet(Math.floor(bet / 2))}
              className="flex size-11 items-center justify-center rounded-[12px] border border-white/10 bg-[#1a1524] text-sm font-bold text-white active:scale-95"
            >
              ½
            </button>
            <button
              type="button"
              onClick={() => updateBet(bet * 2)}
              className="flex size-11 items-center justify-center rounded-[12px] border border-white/10 bg-[#1a1524] text-sm font-bold text-white active:scale-95"
            >
              2×
            </button>
            <div className="flex min-h-11 flex-1 items-center justify-between rounded-full border border-[rgb(139_61_255/35%)] bg-[#0c0914] px-4">
              <span className="text-lg font-bold tabular-nums text-white">
                {bet.toLocaleString('ru-RU')}
              </span>
              <CoinIcon className="size-5" />
            </div>
            <button
              type="button"
              onClick={() => updateBet(amount)}
              className="min-h-11 rounded-[12px] border border-white/10 bg-[#1a1524] px-3 text-xs font-bold text-white active:scale-95"
            >
              МАКС
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {quickBets.map((value) => {
              const disabled = value > amount
              const active = bet === value
              return (
                <button
                  key={value}
                  type="button"
                  disabled={disabled}
                  onClick={() => updateBet(value)}
                  className={[
                    'min-h-9 rounded-full border px-3 text-xs font-semibold transition',
                    active
                      ? 'border-[rgb(255_106_43/70%)] bg-[rgb(255_106_43/20%)] text-white'
                      : 'border-white/10 bg-[#1a1524] text-[#cfc8df]',
                    disabled ? 'opacity-40' : 'active:scale-95',
                  ].join(' ')}
                >
                  {value.toLocaleString('ru-RU')}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            disabled={!canBet}
            onClick={() => void handleBet()}
            className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-[linear-gradient(180deg,#ffb020,#f59e0b)] px-4 py-3.5 text-[15px] font-bold text-[#1a1000] shadow-[0_8px_24px_rgb(245_158_11/35%)] transition active:scale-[0.98] disabled:opacity-45"
          >
            {busy ? 'Отправка…' : 'Поставить'}
          </button>
          {viewerInRound ? (
            <p className="mt-2 text-center text-xs text-white/50">Вы уже в этом раунде</p>
          ) : null}
          {account.telegramId > 0 && amount < minBet ? (
            <p className="mt-2 text-xs text-amber-300/90">
              Нужно минимум {minBet} монет.
            </p>
          ) : null}
        </section>
      ) : null}

      {viewerInRound && round?.status === 'waiting' ? (
        <p className="mb-3 rounded-[14px] border border-white/10 bg-[#120e1a] px-3 py-2.5 text-center text-[13px] text-white/65">
          Ставка принята. Ожидаем второго игрока…
        </p>
      ) : null}

      <RollPlayerList round={round} />
    </div>
  )
}

function potLabel(round: RollRound) {
  if (!round.pot) {
    return null
  }
  return (
    <p className="mb-2 text-center text-[12px] font-semibold text-white/50">
      Банк: {formatBalance(round.pot)} монет
    </p>
  )
}
