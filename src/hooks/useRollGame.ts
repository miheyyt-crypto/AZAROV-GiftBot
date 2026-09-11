import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useNotifications } from '@/components/NotificationProvider'
import type { RollSpinClock } from '@/components/roll/RollWheel'
import { useBalance } from '@/hooks/useBalance'
import { useUserAccount } from '@/hooks/useUserAccount'
import { fetchRollState, placeRollBet, subscribeRollStream } from '@/lib/roll'
import {
  createRollPollScheduler,
  rollDebug,
  shouldPauseRollPollingWhenHidden,
  subscribeRollResume,
} from '@/lib/roll-runtime'
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

/** Shared Roll game state for Mobile + Desktop presentation layers. */
export function useRollGame() {
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

  const bettingOpen = round?.status === 'waiting' || round?.status === 'betting'
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

  const canRevealResultUi = useCallback((r: RollRound) => {
    const clock = spinClockRef.current
    let startedAtMs = NaN
    if (clock && clock.roundId === r.id) {
      startedAtMs = clock.startedAtMs
    } else if (r.spinStartedAt) {
      startedAtMs = Date.parse(r.spinStartedAt) - skewRef.current
    }
    if (!Number.isFinite(startedAtMs)) {
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
        setSpinClock((prev) => {
          if (prev && prev.roundId === next.roundId && prev.targetAngle === next.targetAngle) {
            spinClockRef.current = prev
            return prev
          }
          spinClockRef.current = next
          return next
        })
      } else if (r?.status === 'completed') {
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

  const pollFailuresRef = useRef(0)
  const syncErrorShownRef = useRef(false)
  const statusRef = useRef<string | null>(null)
  statusRef.current = round?.status ?? null

  const recoverActiveRoll = useCallback(
    async (reason: string) => {
      rollDebug(reason)
      const payload = await fetchRollState()
      if (!payload.success && !payload.round) {
        pollFailuresRef.current += 1
        rollDebug('error', {
          code: payload.code,
          failures: pollFailuresRef.current,
        })
        // Backend unreachable while a round is in progress — surface once, allow retry via resume.
        if (
          pollFailuresRef.current >= 4 &&
          !syncErrorShownRef.current &&
          (statusRef.current === 'waiting' ||
            statusRef.current === 'betting' ||
            statusRef.current === 'spinning' ||
            statusRef.current === 'locked')
        ) {
          syncErrorShownRef.current = true
          showNotification({
            type: 'warning',
            title: 'Нет связи с Roll',
            message: payload.message || 'Не удалось обновить игру. Проверьте сеть и вернитесь в приложение.',
          })
        }
        return
      }
      pollFailuresRef.current = 0
      syncErrorShownRef.current = false
      if (payload.round?.status === 'spinning' || payload.round?.status === 'completed') {
        rollDebug('backend result', {
          status: payload.round.status,
          roundId: payload.round.id,
        })
      } else {
        rollDebug('poll response status', {
          status: payload.round?.status,
          players: payload.round?.players?.length || 0,
        })
      }
      applyState(payload)
    },
    [applyState, showNotification],
  )

  useEffect(() => {
    let cancelled = false
    rollDebug('start')
    void recoverActiveRoll('bootstrap').then(() => {
      if (!cancelled) {
        setBootstrapped(true)
      }
    })
    return () => {
      cancelled = true
      rollDebug('cleanup')
    }
  }, [recoverActiveRoll])

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

  useEffect(() => {
    if (!bootstrapped) {
      return
    }

    const pauseWhenHidden = shouldPauseRollPollingWhenHidden()
    const scheduler = createRollPollScheduler({
      poll: () => recoverActiveRoll('poll'),
      shouldSkipTick: () => {
        if (!pauseWhenHidden) {
          return false
        }
        return typeof document !== 'undefined' && document.visibilityState === 'hidden'
      },
    })

    scheduler.start(() => {
      const status = statusRef.current
      if (status === 'spinning' || status === 'locked') {
        return ROLL_POLL_MS_SPIN
      }
      if (status === 'betting' || status === 'completed' || status === 'waiting') {
        return ROLL_POLL_MS_ACTIVE
      }
      return ROLL_POLL_MS_IDLE
    })

    const stopResume = subscribeRollResume(() => {
      scheduler.recover('recover')
    })

    return () => {
      stopResume()
      scheduler.stop()
    }
  }, [bootstrapped, recoverActiveRoll])

  useEffect(() => {
    if (round?.status !== 'betting' || !round.bettingEndsAt) {
      return
    }
    const endsAt = round.bettingEndsAt
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Date.parse(endsAt) - serverNowApprox())
      setCountdownMs(remaining)
      if (remaining <= 0 && !forcedFetchAtZero.current) {
        forcedFetchAtZero.current = true
        void recoverActiveRoll('betting-end')
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [recoverActiveRoll, round?.status, round?.bettingEndsAt, serverNowApprox])

  useEffect(() => {
    if (!spinClock) {
      return
    }
    const clock = spinClock
    spinClockRef.current = clock
    const revealDelay = Math.max(0, clock.startedAtMs + ROLL_WINNER_REVEAL_AFTER_MS - Date.now())
    const endDelay = Math.max(0, clock.endsAtMs - Date.now())

    rollDebug('animation start', { roundId: clock.roundId })

    const revealTimer = window.setTimeout(() => {
      tryRevealResult(roundRef.current)
    }, revealDelay)

    const endTimer = window.setTimeout(() => {
      tryRevealResult(roundRef.current)
      if (!forcedFetchAtSpinEnd.current) {
        forcedFetchAtSpinEnd.current = true
        void recoverActiveRoll('spin-end')
      }
      setSpinClock((prev) => {
        if (prev && prev.roundId === clock.roundId && Date.now() >= prev.endsAtMs) {
          spinClockRef.current = null
          rollDebug('animation end', { roundId: clock.roundId })
          return null
        }
        return prev
      })
    }, endDelay)

    return () => {
      window.clearTimeout(revealTimer)
      window.clearTimeout(endTimer)
    }
  }, [recoverActiveRoll, spinClock, tryRevealResult])

  useEffect(() => {
    if (!bettingOpen) {
      return
    }
    syncBetValue(bet)
    // Intentionally omit `bet` — only re-clamp when balance/floor/open changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    rollDebug('start', { action: 'bet', bet })
    console.info('[ROLL BET] loading true')
    try {
      const result = await placeRollBet({ bet })
      setBusy(false)
      console.info('[ROLL BET] loading false (http done)', {
        success: result.success,
        code: result.code,
      })
      try {
        applyState(result)
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
        rollDebug('created rollId', {
          roundId: result.round?.id,
          status: result.round?.status,
          players: result.round?.players?.length || 0,
        })
        syncBetValue(Math.min(Math.max(amountFloor, minBet), Math.max(amountFloor, amount)))
        // Android WebView may drop the bet response body or skip SSE — resync from backend.
        void recoverActiveRoll('post-bet')
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
    }
  }

  const displayRound = useMemo(() => round, [round])

  const closeWinnerCard = useCallback(() => setWinnerCardOpen(false), [])

  return {
    amount,
    formatted,
    account,
    bet,
    betInput,
    busy,
    bootstrapped,
    round,
    previousGame,
    topGame,
    viewerInRound,
    countdownMs,
    spinClock,
    showConfetti,
    confettiKey,
    winnerCardOpen,
    winnerCardRound,
    minBet,
    quickBets,
    bettingOpen,
    myStake,
    addMode,
    amountFloor,
    canSubmit,
    displayRound,
    syncBetValue,
    updateBet,
    onBetInputChange,
    handleBet,
    closeWinnerCard,
  }
}
