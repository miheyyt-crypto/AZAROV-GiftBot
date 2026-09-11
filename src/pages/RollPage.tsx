import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CoinIcon } from '@/components/CoinIcon'
import { useNotifications } from '@/components/NotificationProvider'
import { RollConfetti } from '@/components/roll/RollConfetti'
import { RollPlayerList } from '@/components/roll/RollPlayerList'
import { RollStatsCards } from '@/components/roll/RollStatsCards'
import { RollWheel, type RollSpinClock } from '@/components/roll/RollWheel'
import { RollWinnerCard } from '@/components/roll/RollWinnerCard'
import { useBalance } from '@/hooks/useBalance'
import { useUserAccount } from '@/hooks/useUserAccount'
import { ROUTES } from '@/lib/constants'
import { formatBalance } from '@/lib/balance'
import { fetchRollState, placeRollBet, subscribeRollStream } from '@/lib/roll'
import {
  ROLL_MAX_PLAYERS,
  ROLL_MIN_BET,
  ROLL_POLL_MS_ACTIVE,
  ROLL_POLL_MS_IDLE,
  ROLL_POLL_MS_SPIN,
  ROLL_QUICK_BETS,
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

/** Estimate server − client clock offset using RTT midpoint. */
function estimateSkew(
  serverNowMs: number | undefined,
  serverNowIso: string | undefined,
  clientSentAt?: number,
  clientReceivedAt?: number,
): number {
  const serverMs =
    typeof serverNowMs === 'number' && Number.isFinite(serverNowMs)
      ? serverNowMs
      : Date.parse(serverNowIso || '')
  if (!Number.isFinite(serverMs)) {
    return 0
  }
  if (
    typeof clientSentAt === 'number' &&
    typeof clientReceivedAt === 'number' &&
    clientReceivedAt >= clientSentAt
  ) {
    const midpoint = (clientSentAt + clientReceivedAt) / 2
    return serverMs - midpoint
  }
  return serverMs - Date.now()
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
  const [previousGame, setPreviousGame] = useState<RollGameCard | null>(null)
  const [topGame, setTopGame] = useState<RollGameCard | null>(null)
  const [viewerInRound, setViewerInRound] = useState(false)
  const [config, setConfig] = useState<RollConfig | null>(null)
  const [countdownMs, setCountdownMs] = useState<number | null>(null)
  const [spinClock, setSpinClock] = useState<RollSpinClock | null>(null)
  const [showConfetti, setShowConfetti] = useState(false)
  const [confettiKey, setConfettiKey] = useState<string | null>(null)
  const [winnerCardOpen, setWinnerCardOpen] = useState(false)
  const [winnerCardRound, setWinnerCardRound] = useState<RollRound | null>(null)

  const skewRef = useRef(0)
  const confettiForRound = useRef<string | null>(null)
  const winnerCardForRound = useRef<string | null>(null)
  const loseToastForRound = useRef<string | null>(null)
  const lastVersionRef = useRef(0)
  const lastRoundIdRef = useRef<string | null>(null)
  const streamOpenRef = useRef(false)
  const forcedFetchAtZero = useRef(false)

  const minBet = config?.minBet ?? ROLL_MIN_BET
  const quickBets = config?.quickBets?.length ? config.quickBets : [...ROLL_QUICK_BETS]

  const bettingOpen =
    round?.status === 'waiting' || round?.status === 'betting'
  const canBet =
    !busy &&
    !viewerInRound &&
    bettingOpen &&
    (round.players?.length || 0) < (round.maxPlayers || ROLL_MAX_PLAYERS) &&
    amount >= minBet &&
    bet >= minBet &&
    bet <= amount

  const serverNowApprox = useCallback(() => Date.now() + skewRef.current, [])

  const applyState = useCallback(
    (payload: Awaited<ReturnType<typeof fetchRollState>>) => {
      if (!payload.success && !payload.round) {
        return
      }

      const incomingVersion = Number(payload.round?.version) || 0
      const incomingRoundId = payload.round?.id || null
      if (
        incomingRoundId &&
        lastRoundIdRef.current === incomingRoundId &&
        incomingVersion > 0 &&
        lastVersionRef.current > 0 &&
        incomingVersion < lastVersionRef.current
      ) {
        return
      }
      if (incomingRoundId) {
        lastRoundIdRef.current = incomingRoundId
      }
      if (incomingVersion > 0) {
        lastVersionRef.current = incomingVersion
      }

      skewRef.current = estimateSkew(
        payload.serverNowMs,
        payload.serverNow,
        payload.clientSentAt,
        payload.clientReceivedAt,
      )

      const r = payload.round
      const viewerId = account.telegramId
      const inRound = Boolean(
        payload.viewerInRound ||
          (viewerId > 0 &&
            (r?.players || []).some((p) => Number(p.userId) === Number(viewerId))),
      )

      setRound(r)
      setPreviousGame(payload.previousGame)
      setTopGame(payload.topGame)
      setViewerInRound(inRound)
      if (payload.config) {
        setConfig(payload.config)
      }

      if (r?.status === 'betting' && r.bettingEndsAt) {
        const ends = Date.parse(r.bettingEndsAt)
        const remaining = Math.max(0, ends - serverNowApprox())
        setCountdownMs(remaining)
        if (remaining > 200) {
          forcedFetchAtZero.current = false
        }
      } else {
        setCountdownMs(null)
        forcedFetchAtZero.current = false
      }

      if (r?.status === 'spinning' && r.spinStartedAt && r.spinEndsAt && r.targetAngle != null) {
        const startedAtMs = Date.parse(r.spinStartedAt) - skewRef.current
        const endsAtMs = Date.parse(r.spinEndsAt) - skewRef.current
        const next: RollSpinClock = {
          roundId: r.id,
          startedAtMs,
          endsAtMs,
          targetAngle: Number(r.targetAngle),
        }
        // Freeze clock for this round — poll/SSE skew must NOT rewrite timeline mid-spin.
        setSpinClock((prev) => {
          if (prev && prev.roundId === next.roundId && prev.targetAngle === next.targetAngle) {
            return prev
          }
          return next
        })
      } else if (r?.status === 'completed') {
        setSpinClock(null)
      } else if (r?.status === 'waiting' || r?.status === 'betting') {
        setSpinClock(null)
      }

      const completed = r?.status === 'completed' ? r : null

      if (completed && Number(completed.winnerUserId) === Number(account.telegramId) && account.telegramId > 0) {
        if (winnerCardForRound.current !== completed.id) {
          winnerCardForRound.current = completed.id
          setWinnerCardRound(completed)
          setWinnerCardOpen(true)
          // Confetti starts after slide-in via onEntered — not here.
        }
      } else if (
        completed &&
        viewerParticipated(completed, account.telegramId) &&
        Number(completed.winnerUserId) !== Number(account.telegramId)
      ) {
        if (loseToastForRound.current !== completed.id) {
          loseToastForRound.current = completed.id
          showNotification({
            type: 'warning',
            title: 'Раунд завершён',
            message: `Победитель: ${completed.winner ? formatUser(completed) : '—'}`,
          })
        }
      }

      if (r?.status === 'waiting' && (r.players?.length || 0) === 0 && !payload.lastResult) {
        setWinnerCardOpen(false)
        lastVersionRef.current = Number(r.version) || 0
      }
    },
    [account.telegramId, serverNowApprox, showNotification],
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

  // Primary realtime: SSE push (fetch stream).
  useEffect(() => {
    if (!bootstrapped) {
      return
    }
    const stop = subscribeRollStream(
      (payload) => {
        applyState(payload)
      },
      (status) => {
        streamOpenRef.current = status === 'open'
      },
    )
    return () => {
      streamOpenRef.current = false
      stop()
    }
  }, [applyState, bootstrapped])

  // Slow reconciliation poll (fallback if SSE drops).
  useEffect(() => {
    if (!bootstrapped) {
      return
    }
    const status = round?.status
    const ms =
      status === 'spinning' || status === 'locked'
        ? ROLL_POLL_MS_SPIN
        : status === 'betting' || status === 'completed' || status === 'waiting'
          ? ROLL_POLL_MS_ACTIVE
          : ROLL_POLL_MS_IDLE
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
      const remaining = Math.max(0, Date.parse(endsAt) - serverNowApprox())
      setCountdownMs(remaining)
      // When local countdown hits 0, immediately reconcile — server ticker + SSE should
      // already be spinning; this covers missed events without waiting for slow poll.
      if (remaining <= 0 && !forcedFetchAtZero.current) {
        forcedFetchAtZero.current = true
        void fetchRollState().then(applyState)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [applyState, round?.status, round?.bettingEndsAt, serverNowApprox])

  useEffect(() => {
    if (!bettingOpen) {
      return
    }
    setBet((current) => clampBet(current, amount, minBet))
  }, [amount, minBet, bettingOpen])

  const updateBet = useCallback(
    (next: number) => {
      if (!bettingOpen || viewerInRound) {
        return
      }
      setBet(clampBet(next, amount, minBet))
    },
    [amount, minBet, bettingOpen, viewerInRound],
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

  const displayRound = useMemo(() => {
    if (round?.status === 'spinning' || round?.status === 'completed' || round?.status === 'locked') {
      return round
    }
    return round
  }, [round])

  if (!bootstrapped) {
    return (
      <div className="ui-page">
        <div className="h-10 w-40 animate-pulse rounded-xl bg-white/[0.06]" />
        <div className="mt-4 aspect-square animate-pulse rounded-full bg-white/[0.04]" />
      </div>
    )
  }

  return (
    <div className="roll-page ui-page relative overflow-x-hidden pb-8">
      {winnerCardRound ? (
        <RollWinnerCard
          round={winnerCardRound}
          open={winnerCardOpen}
          onClose={() => setWinnerCardOpen(false)}
          onEntered={() => {
            if (!winnerCardRound) {
              return
            }
            if (confettiForRound.current === winnerCardRound.id) {
              return
            }
            confettiForRound.current = winnerCardRound.id
            setConfettiKey(winnerCardRound.id)
            setShowConfetti(true)
          }}
        />
      ) : null}

      <RollConfetti active={showConfetti && winnerCardOpen} burstKey={confettiKey} />

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

      <RollStatsCards previousGame={previousGame} topGame={topGame} />

      <RollWheel
        round={displayRound}
        countdownMs={countdownMs}
        spinClock={spinClock}
      />

      {(round?.status === 'waiting' || round?.status === 'betting') && potLabel(round)}

      {bettingOpen && !viewerInRound ? (
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
          {account.telegramId > 0 && amount < minBet ? (
            <p className="mt-2 text-xs text-amber-300/90">Нужно минимум {minBet} монет.</p>
          ) : null}
        </section>
      ) : null}

      {viewerInRound && round?.status === 'waiting' ? (
        <p className="mb-3 rounded-[14px] border border-white/10 bg-[#120e1a] px-3 py-2.5 text-center text-[13px] text-white/65">
          Ставка принята. Ожидаем второго игрока…
        </p>
      ) : null}

      {viewerInRound && round?.status === 'betting' ? (
        <p className="mb-3 rounded-[14px] border border-white/10 bg-[#120e1a] px-3 py-2.5 text-center text-[13px] text-white/65">
          Ставка принята. Можно присоединяться другим игрокам…
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

function viewerParticipated(round: RollRound, telegramId: number): boolean {
  return (round.players || []).some((p) => Number(p.userId) === Number(telegramId))
}

function formatUser(round: RollRound): string {
  const w = round.winner
  if (!w) {
    return '—'
  }
  const u = String(w.username || '').trim()
  if (u) {
    return u.startsWith('@') ? u : `@${u}`
  }
  return w.firstName || 'игрок'
}
