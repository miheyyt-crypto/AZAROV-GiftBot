import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CoinIcon } from '@/components/CoinIcon'
import { useNotifications } from '@/components/NotificationProvider'
import { RollConfetti } from '@/components/roll/RollConfetti'
import { RollLavaBackground } from '@/components/roll/RollLavaBackground'
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
  ROLL_WINNER_REVEAL_AFTER_MS,
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

function parseBetInput(raw: string): number | null {
  const digits = String(raw || '').replace(/[^\d]/g, '')
  if (!digits) {
    return null
  }
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
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
  const [betInput, setBetInput] = useState(String(ROLL_MIN_BET))
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
  const forcedFetchAtSpinEnd = useRef(false)
  const spinClockRef = useRef<RollSpinClock | null>(null)
  const roundRef = useRef<RollRound | null>(null)

  const minBet = config?.minBet ?? ROLL_MIN_BET
  const quickBets = config?.quickBets?.length ? config.quickBets : [...ROLL_QUICK_BETS]

  const bettingOpen =
    round?.status === 'waiting' || round?.status === 'betting'
  const myStake =
    viewerInRound && account.telegramId > 0
      ? Number(
          (round?.players || []).find((p) => Number(p.userId) === Number(account.telegramId))
            ?.bet || 0,
        )
      : 0
  const addMode = Boolean(viewerInRound && bettingOpen && myStake > 0)
  const amountFloor = addMode ? 1 : minBet

  const canSubmit =
    !busy &&
    bettingOpen &&
    bet >= amountFloor &&
    bet <= amount &&
    amount >= amountFloor &&
    (addMode || (round?.players?.length || 0) < (round?.maxPlayers || ROLL_MAX_PLAYERS))

  const syncBetValue = useCallback(
    (next: number) => {
      const clamped = clampBet(next, amount, amountFloor)
      setBet(clamped)
      setBetInput(String(clamped))
    },
    [amount, amountFloor],
  )

  const serverNowApprox = useCallback(() => Date.now() + skewRef.current, [])

  /** Winner/lose UI only after 7s from spin start — never before the wheel has mostly spun. */
  const canRevealResultUi = useCallback((r: RollRound) => {
    const clock = spinClockRef.current
    let startedAtMs = NaN
    if (clock && clock.roundId === r.id) {
      startedAtMs = clock.startedAtMs
    } else if (r.spinStartedAt) {
      startedAtMs = Date.parse(r.spinStartedAt) - skewRef.current
    }
    if (!Number.isFinite(startedAtMs)) {
      // Reconnect into a finished round with no timeline — allow once.
      return r.status === 'completed'
    }
    return Date.now() >= startedAtMs + ROLL_WINNER_REVEAL_AFTER_MS
  }, [])

  const revealWinnerUi = useCallback(
    (r: RollRound) => {
      if (!r?.id || !r.winner || account.telegramId <= 0) {
        return
      }
      if (Number(r.winnerUserId) !== Number(account.telegramId)) {
        return
      }
      if (winnerCardForRound.current === r.id) {
        return
      }
      if (!canRevealResultUi(r)) {
        return
      }
      winnerCardForRound.current = r.id
      setWinnerCardRound(r)
      setWinnerCardOpen(true)
      // Confetti starts with card enter — do not wait for slide-in end.
      if (confettiForRound.current !== r.id) {
        confettiForRound.current = r.id
        setConfettiKey(r.id)
        setShowConfetti(true)
      }
    },
    [account.telegramId, canRevealResultUi],
  )

  const revealLoseToast = useCallback(
    (r: RollRound) => {
      if (!r?.id || account.telegramId <= 0) {
        return
      }
      if (!viewerParticipated(r, account.telegramId)) {
        return
      }
      if (Number(r.winnerUserId) === Number(account.telegramId)) {
        return
      }
      if (loseToastForRound.current === r.id) {
        return
      }
      if (!canRevealResultUi(r)) {
        return
      }
      loseToastForRound.current = r.id
      showNotification({
        type: 'warning',
        title: 'Раунд завершён',
        message: `Победитель: ${r.winner ? formatUser(r) : '—'}`,
      })
    },
    [account.telegramId, canRevealResultUi, showNotification],
  )

  const tryRevealResult = useCallback(
    (r: RollRound | null | undefined) => {
      if (!r) {
        return
      }
      // Winner is fixed at spin lock — spinning payload already has winnerId/payout.
      const resultReady =
        (r.status === 'spinning' || r.status === 'completed') &&
        r.winnerUserId != null &&
        Boolean(r.winner)
      if (!resultReady) {
        return
      }
      revealWinnerUi(r)
      if (r.status === 'completed') {
        revealLoseToast(r)
      }
    },
    [revealLoseToast, revealWinnerUi],
  )

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

      roundRef.current = r
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
        forcedFetchAtSpinEnd.current = false
        // Freeze clock for this round — poll/SSE skew must NOT rewrite timeline mid-spin.
        setSpinClock((prev) => {
          if (prev && prev.roundId === next.roundId && prev.targetAngle === next.targetAngle) {
            spinClockRef.current = prev
            return prev
          }
          spinClockRef.current = next
          return next
        })
      } else if (r?.status === 'completed') {
        // Keep local spin clock until wheel timeline ends — avoid aborting animation early.
        setSpinClock((prev) => {
          if (prev && prev.roundId === r.id && Date.now() < prev.endsAtMs) {
            spinClockRef.current = prev
            return prev
          }
          spinClockRef.current = null
          return null
        })
      } else if (r?.status === 'waiting' || r?.status === 'betting') {
        spinClockRef.current = null
        setSpinClock(null)
      }

      tryRevealResult(r)

      if (r?.status === 'waiting' && (r.players?.length || 0) === 0 && !payload.lastResult) {
        setWinnerCardOpen(false)
        lastVersionRef.current = Number(r.version) || 0
      }
    },
    [account.telegramId, serverNowApprox, tryRevealResult],
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

  // Reveal winner UI 7s after spin start; reconcile/fetch when full spin timeline ends.
  useEffect(() => {
    if (!spinClock) {
      return
    }
    const clock = spinClock
    spinClockRef.current = clock
    const revealDelay = Math.max(0, clock.startedAtMs + ROLL_WINNER_REVEAL_AFTER_MS - Date.now())
    const endDelay = Math.max(0, clock.endsAtMs - Date.now())

    const revealTimer = window.setTimeout(() => {
      tryRevealResult(roundRef.current)
    }, revealDelay)

    const endTimer = window.setTimeout(() => {
      tryRevealResult(roundRef.current)
      if (!forcedFetchAtSpinEnd.current) {
        forcedFetchAtSpinEnd.current = true
        void fetchRollState().then(applyState)
      }
      setSpinClock((prev) => {
        if (prev && prev.roundId === clock.roundId && Date.now() >= prev.endsAtMs) {
          spinClockRef.current = null
          return null
        }
        return prev
      })
    }, endDelay)

    return () => {
      window.clearTimeout(revealTimer)
      window.clearTimeout(endTimer)
    }
  }, [applyState, spinClock, tryRevealResult])

  useEffect(() => {
    if (!bettingOpen) {
      return
    }
    syncBetValue(bet)
  }, [amount, amountFloor, bettingOpen, syncBetValue])

  const updateBet = useCallback(
    (next: number) => {
      if (!bettingOpen) {
        return
      }
      syncBetValue(next)
    },
    [bettingOpen, syncBetValue],
  )

  function onBetInputChange(raw: string) {
    const cleaned = raw.replace(/[^\d]/g, '')
    setBetInput(cleaned)
    const parsed = parseBetInput(cleaned)
    if (parsed == null) {
      setBet(amountFloor)
      return
    }
    setBet(Math.min(parsed, Math.max(0, Math.floor(amount))))
  }

  async function handleBet() {
    if (busy) {
      return
    }
    if (!canSubmit) {
      if (amount < amountFloor) {
        showNotification({
          type: 'warning',
          title: 'Недостаточно монет',
          message: addMode
            ? 'Недостаточно монет для пополнения.'
            : `Минимальная ставка — ${minBet} монет.`,
        })
      }
      return
    }
    setBusy(true)
    console.info('[ROLL BET] loading true')
    try {
      const result = await placeRollBet({ bet })
      // Unlock button from HTTP completion — never wait for SSE/poll.
      setBusy(false)
      console.info('[ROLL BET] loading false (http done)', {
        success: result.success,
        code: result.code,
      })
      try {
        applyState(result)
        console.info('[ROLL BET] state applied')
      } catch (error) {
        console.warn('[ROLL BET] applyState failed', error)
      }
      if (!result.success) {
        showNotification({
          type: 'warning',
          title: addMode ? 'Пополнение не принято' : 'Ставка не принята',
          message: result.message || 'Попробуйте ещё раз.',
        })
      } else {
        syncBetValue(Math.min(Math.max(amountFloor, minBet), Math.max(amountFloor, amount)))
      }
    } catch (error) {
      console.warn('[ROLL BET] unexpected error', error)
      setBusy(false)
      showNotification({
        type: 'warning',
        title: addMode ? 'Пополнение не принято' : 'Ставка не принята',
        message: 'Не удалось отправить ставку. Попробуйте ещё раз.',
      })
    } finally {
      setBusy(false)
      console.info('[ROLL BET] loading false (finally)')
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
    <div
      className="roll-page ui-page relative overflow-x-hidden"
      data-roll-phase={round?.status || 'waiting'}
    >
      <RollLavaBackground phase={round?.status || 'waiting'} />

      {winnerCardRound ? (
        <RollWinnerCard
          round={winnerCardRound}
          open={winnerCardOpen}
          onClose={() => setWinnerCardOpen(false)}
        />
      ) : null}

      <RollConfetti active={showConfetti && winnerCardOpen} burstKey={confettiKey} />

      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(ROUTES.home)}
          className="roll-glass flex size-10 shrink-0 items-center justify-center rounded-[12px] text-white/85 transition active:scale-95"
          aria-label="В главное меню"
        >
          <ArrowLeft size={18} aria-hidden />
        </button>
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-xl font-bold text-white drop-shadow-[0_2px_12px_rgb(0_0_0/45%)]">
          <span aria-hidden>🍥</span>
          <span>Roll</span>
        </h1>
        <div
          className="roll-balance-pill inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-semibold text-white"
          aria-label={`Баланс ${formatted}`}
        >
          <CoinIcon className="size-4" />
          <span className="tabular-nums">{formatted}</span>
        </div>
      </header>

      <RollStatsCards previousGame={previousGame} topGame={topGame} />

      {(round?.status === 'waiting' ||
        round?.status === 'betting' ||
        round?.status === 'spinning' ||
        round?.status === 'locked' ||
        round?.status === 'completed') &&
        potPill(round)}

      <div className="roll-wheel-stage">
        <RollWheel
          round={displayRound}
          countdownMs={countdownMs}
          spinClock={spinClock}
        />
      </div>

      {bettingOpen ? (
        <section className="roll-glass roll-bet-panel rounded-[20px] p-3.5 sm:p-4">
          {addMode ? (
            <div className="mb-2.5 flex items-center justify-between gap-2 sm:mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab]">
                Добавить к ставке
              </p>
              <p className="inline-flex items-center gap-1 text-[13px] font-bold text-white">
                Твоя ставка:
                <span className="tabular-nums text-[#7dd3fc]">{formatBalance(myStake)}</span>
                <CoinIcon className="size-3.5" />
              </p>
            </div>
          ) : (
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab] sm:mb-3">
              Сумма ставки
            </p>
          )}

          <div className="mb-2.5 flex items-center gap-2 sm:mb-3">
            <button
              type="button"
              onClick={() => updateBet(Math.max(amountFloor, Math.floor(bet / 2)))}
              className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-[#1a1524] text-sm font-bold text-white active:scale-95 sm:size-11"
            >
              ½
            </button>
            <button
              type="button"
              onClick={() => updateBet(bet * 2)}
              className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-[#1a1524] text-sm font-bold text-white active:scale-95 sm:size-11"
            >
              2×
            </button>
            <label className="flex min-h-10 min-w-0 flex-1 items-center justify-between rounded-full border border-[rgb(139_61_255/35%)] bg-[#0c0914] px-3 sm:min-h-11 sm:px-4">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                value={betInput}
                onChange={(e) => onBetInputChange(e.target.value)}
                onBlur={() => syncBetValue(bet)}
                placeholder="Введите сумму"
                aria-label={addMode ? 'Сумма пополнения' : 'Сумма ставки'}
                className="min-w-0 flex-1 bg-transparent text-base font-bold tabular-nums text-white outline-none placeholder:text-white/30 sm:text-lg"
              />
              <CoinIcon className="size-5 shrink-0" />
            </label>
            <button
              type="button"
              onClick={() => updateBet(amount)}
              className="min-h-10 shrink-0 rounded-[12px] border border-white/10 bg-[#1a1524] px-2.5 text-[11px] font-bold text-white active:scale-95 sm:min-h-11 sm:px-3 sm:text-xs"
            >
              МАКС
            </button>
          </div>

          <div className="mb-2.5 flex flex-wrap gap-2 sm:mb-3">
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
                  {addMode ? `+${value.toLocaleString('ru-RU')}` : value.toLocaleString('ru-RU')}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void handleBet()}
            className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-[linear-gradient(180deg,#ffb020,#f59e0b)] px-4 py-3 text-[15px] font-bold text-[#1a1000] shadow-[0_8px_24px_rgb(245_158_11/35%)] transition active:scale-[0.98] disabled:opacity-45 sm:py-3.5"
          >
            {busy
              ? addMode
                ? 'Добавляем…'
                : 'Отправка…'
              : addMode
                ? 'Добавить'
                : 'Поставить'}
          </button>
          {account.telegramId > 0 && amount < amountFloor ? (
            <p className="mt-2 text-xs text-amber-300/90">
              {addMode
                ? 'Недостаточно монет для пополнения.'
                : `Нужно минимум ${minBet} монет.`}
            </p>
          ) : null}
        </section>
      ) : null}

      {viewerInRound && round?.status === 'waiting' ? (
        <p className="roll-glass roll-hint rounded-[14px] px-3 py-2.5 text-center text-[13px] text-white/65">
          Можно увеличить ставку, пока ждём второго игрока.
        </p>
      ) : null}

      {viewerInRound && round?.status === 'betting' ? (
        <p className="roll-glass roll-hint rounded-[14px] px-3 py-2.5 text-center text-[13px] text-white/65">
          Можно увеличить ставку до конца отсчёта.
        </p>
      ) : null}

      {viewerInRound && !bettingOpen ? (
        <p className="roll-glass roll-hint rounded-[14px] px-3 py-2.5 text-center text-[13px] text-white/65">
          Ставки закрыты
        </p>
      ) : null}

      <RollPlayerList round={round} />
    </div>
  )
}

function potPill(round: RollRound | null) {
  const pot = Number(round?.pot) || 0
  return (
    <div className="roll-pot-pill-wrap flex justify-center">
      <div className="roll-pot-pill">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
          Всего
        </span>
        <span className="text-[13px] font-bold tabular-nums text-[#7dd3fc]">
          {formatBalance(pot)}
        </span>
        <CoinIcon className="size-3.5" />
      </div>
    </div>
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
