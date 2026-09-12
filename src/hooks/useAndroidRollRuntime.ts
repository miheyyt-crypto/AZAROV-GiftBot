import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useNotifications } from '@/components/NotificationProvider'
import type { RollSpinClock } from '@/components/roll/RollWheel'
import { useBalance } from '@/hooks/useBalance'
import { useUserAccount } from '@/hooks/useUserAccount'
import {
  ANDROID_POLL_MS_ACTIVE,
  ANDROID_POLL_MS_IDLE,
  ANDROID_SYNC_FAIL_LIMIT,
  androidRollDebug,
  createAndroidRollPoller,
  readActiveAndroidRollId,
  resolveAndroidPhase,
  subscribeAndroidRollResume,
  writeActiveAndroidRollId,
  type AndroidRollPhase,
} from '@/lib/android-roll-runtime'
import { fetchRollState, placeRollBet } from '@/lib/roll'
import {
  ROLL_MAX_PLAYERS,
  ROLL_MIN_BET,
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
    return serverMs - (clientSentAt + clientReceivedAt) / 2
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

/**
 * Android Telegram Mini App Roll runtime.
 * Backend is source of truth. No SSE. No RAF-driven game logic.
 * Animation (spinClock) is presentation-only.
 */
export function useAndroidRollRuntime() {
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
  const [syncError, setSyncError] = useState(false)
  const [activeRoundId, setActiveRoundId] = useState<string | null>(() =>
    readActiveAndroidRollId(),
  )

  const skewRef = useRef(0)
  const confettiForRound = useRef<string | null>(null)
  const winnerCardForRound = useRef<string | null>(null)
  const loseToastForRound = useRef<string | null>(null)
  const roundRef = useRef<RollRound | null>(null)
  const spinClockRef = useRef<RollSpinClock | null>(null)
  const failCountRef = useRef(0)
  const placingRef = useRef(false)
  const activeRoundIdRef = useRef(activeRoundId)
  const viewerInRoundRef = useRef(false)
  const syncErrorRef = useRef(false)
  const betRequestLockRef = useRef(false)

  activeRoundIdRef.current = activeRoundId
  viewerInRoundRef.current = viewerInRound
  syncErrorRef.current = syncError

  const minBet = config?.minBet ?? ROLL_MIN_BET
  const quickBets = config?.quickBets?.length ? config.quickBets : [...ROLL_QUICK_BETS]

  const phase: AndroidRollPhase = resolveAndroidPhase({
    placing: busy || placingRef.current,
    syncError,
    viewerInRound,
    activeRoundId,
    round,
    nowMs: Date.now(),
    skewMs: skewRef.current,
    revealAfterMs: ROLL_WINNER_REVEAL_AFTER_MS,
  })

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
    bootstrapped &&
    !busy &&
    !syncError &&
    phase !== 'placing' &&
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

  const setActiveId = useCallback((id: string | null) => {
    activeRoundIdRef.current = id
    setActiveRoundId(id)
    writeActiveAndroidRollId(id)
    androidRollDebug('activeRollId', { roundId: id })
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
      winnerCardForRound.current = r.id
      setWinnerCardRound(r)
      setWinnerCardOpen(true)
      if (confettiForRound.current !== r.id) {
        confettiForRound.current = r.id
        setConfettiKey(r.id)
        setShowConfetti(true)
      }
      androidRollDebug('result', { roundId: r.id, kind: 'win' })
    },
    [account.telegramId],
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
      loseToastForRound.current = r.id
      showNotification({
        type: 'warning',
        title: 'Раунд завершён',
        message: `Победитель: ${r.winner ? formatUser(r) : '—'}`,
      })
      androidRollDebug('result', { roundId: r.id, kind: 'lose' })
    },
    [account.telegramId, showNotification],
  )

  const applyBackendState = useCallback(
    (payload: Awaited<ReturnType<typeof fetchRollState>>, opts?: { fromBet?: boolean }) => {
      if (!payload.success && !payload.round) {
        return false
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

      androidRollDebug('status', {
        status: r?.status,
        players: r?.players?.length || 0,
        roundId: r?.id,
        inRound,
        fromBet: Boolean(opts?.fromBet),
      })

      if (inRound && r?.id) {
        setActiveId(r.id)
      } else if (
        r &&
        activeRoundIdRef.current &&
        r.id !== activeRoundIdRef.current &&
        (r.status === 'waiting' || r.status === 'betting') &&
        (r.players?.length || 0) === 0
      ) {
        // New empty round after ours finished.
        setActiveId(null)
      }

      if (r?.status === 'betting' && r.bettingEndsAt) {
        const ends = Date.parse(r.bettingEndsAt)
        setCountdownMs(Math.max(0, ends - (Date.now() + skewRef.current)))
      } else {
        setCountdownMs(null)
      }

      // Presentation-only clock — never gates result state machine.
      if (r?.status === 'spinning' && r.spinStartedAt && r.spinEndsAt && r.targetAngle != null) {
        const next: RollSpinClock = {
          roundId: r.id,
          startedAtMs: Date.parse(r.spinStartedAt) - skewRef.current,
          endsAtMs: Date.parse(r.spinEndsAt) - skewRef.current,
          targetAngle: Number(r.targetAngle),
        }
        setSpinClock((prev) => {
          if (prev && prev.roundId === next.roundId && prev.targetAngle === next.targetAngle) {
            spinClockRef.current = prev
            return prev
          }
          spinClockRef.current = next
          androidRollDebug('animation', { roundId: next.roundId, action: 'start' })
          return next
        })
      } else if (r?.status === 'completed' && r.targetAngle != null) {
        const ends = r.spinEndsAt ? Date.parse(r.spinEndsAt) - skewRef.current : Date.now()
        if (Date.now() < ends) {
          // Keep visual spin finishing if still within window.
        } else {
          spinClockRef.current = null
          setSpinClock(null)
        }
      } else if (r?.status === 'waiting' || r?.status === 'betting') {
        spinClockRef.current = null
        setSpinClock(null)
      }

      const phaseNow = resolveAndroidPhase({
        placing: placingRef.current,
        syncError: false,
        viewerInRound: inRound,
        activeRoundId: activeRoundIdRef.current,
        round: r,
        nowMs: Date.now(),
        skewMs: skewRef.current,
        revealAfterMs: ROLL_WINNER_REVEAL_AFTER_MS,
      })

      if (phaseNow === 'result' && r) {
        revealWinnerUi(r)
        if (r.status === 'completed') {
          revealLoseToast(r)
        }
      }

      if (r?.status === 'waiting' && (r.players?.length || 0) === 0 && !payload.lastResult) {
        setWinnerCardOpen(false)
      }

      return true
    },
    [account.telegramId, revealLoseToast, revealWinnerUi, setActiveId],
  )

  const syncFromBackend = useCallback(
    async (reason: string) => {
      androidRollDebug(reason === 'recovery' ? 'recovery' : 'polling', { reason })
      const payload = await fetchRollState()
      if (!payload.success && !payload.round) {
        failCountRef.current += 1
        androidRollDebug('error', {
          code: payload.code,
          failures: failCountRef.current,
        })
        const active =
          Boolean(activeRoundIdRef.current) ||
          viewerInRoundRef.current ||
          placingRef.current
        if (active && failCountRef.current >= ANDROID_SYNC_FAIL_LIMIT) {
          setSyncError(true)
          syncErrorRef.current = true
        }
        return
      }
      failCountRef.current = 0
      if (syncErrorRef.current) {
        setSyncError(false)
        syncErrorRef.current = false
      }
      applyBackendState(payload)
    },
    [applyBackendState],
  )

  const retrySync = useCallback(() => {
    setSyncError(false)
    syncErrorRef.current = false
    failCountRef.current = 0
    void syncFromBackend('retry')
  }, [syncFromBackend])

  useEffect(() => {
    let cancelled = false
    androidRollDebug('start')
    void syncFromBackend('bootstrap').finally(() => {
      if (!cancelled) {
        setBootstrapped(true)
      }
    })
    return () => {
      cancelled = true
      androidRollDebug('cleanup')
    }
  }, [syncFromBackend])

  useEffect(() => {
    if (!bootstrapped) {
      return
    }

    const poller = createAndroidRollPoller({
      poll: () => syncFromBackend('poll'),
      onDebug: androidRollDebug,
    })

    poller.start(() => {
      const active =
        Boolean(activeRoundIdRef.current) ||
        viewerInRoundRef.current ||
        placingRef.current ||
        (roundRef.current &&
          (roundRef.current.status === 'betting' ||
            roundRef.current.status === 'spinning' ||
            roundRef.current.status === 'locked' ||
            ((roundRef.current.players?.length || 0) > 0 &&
              roundRef.current.status === 'waiting')))
      return active ? ANDROID_POLL_MS_ACTIVE : ANDROID_POLL_MS_IDLE
    })

    const stopResume = subscribeAndroidRollResume(() => {
      poller.kick('recovery')
    })

    return () => {
      stopResume()
      poller.stop()
    }
  }, [bootstrapped, syncFromBackend])

  // Wall-clock countdown — not RAF.
  useEffect(() => {
    if (round?.status !== 'betting' || !round.bettingEndsAt) {
      return
    }
    const endsAt = round.bettingEndsAt
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => {
      const remaining = Math.max(0, Date.parse(endsAt) - (Date.now() + skewRef.current))
      setCountdownMs(remaining)
      if (remaining <= 0) {
        void syncFromBackend('betting-end')
        return
      }
      timer = setTimeout(tick, 250)
    }
    tick()
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [round?.status, round?.bettingEndsAt, syncFromBackend])

  // Wall-clock result reveal — independent of animation/RAF.
  useEffect(() => {
    const r = round
    if (!r?.winner || (r.status !== 'spinning' && r.status !== 'completed')) {
      return
    }
    const started = r.spinStartedAt ? Date.parse(r.spinStartedAt) - skewRef.current : NaN
    const revealAt = Number.isFinite(started)
      ? started + ROLL_WINNER_REVEAL_AFTER_MS
      : Date.now()
    const delay = Math.max(0, revealAt - Date.now())
    const timer = setTimeout(() => {
      const current = roundRef.current
      if (!current || current.id !== r.id) {
        return
      }
      revealWinnerUi(current)
      if (current.status === 'completed') {
        revealLoseToast(current)
      }
      void syncFromBackend('result-check')
    }, delay)
    return () => clearTimeout(timer)
  }, [
    round?.id,
    round?.status,
    round?.spinStartedAt,
    round?.winnerUserId,
    revealLoseToast,
    revealWinnerUi,
    syncFromBackend,
  ])

  useEffect(() => {
    if (!bootstrapped || !bettingOpen) {
      return
    }
    syncBetValue(bet)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, amountFloor, bettingOpen, bootstrapped, syncBetValue])

  const updateBet = useCallback(
    (next: number) => {
      if (!bootstrapped || !bettingOpen) {
        return
      }
      syncBetValue(next)
    },
    [bettingOpen, bootstrapped, syncBetValue],
  )

  function onBetInputChange(raw: string) {
    if (!bootstrapped || !bettingOpen) {
      return
    }
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
    if (!bootstrapped || busy || betRequestLockRef.current || placingRef.current) {
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

    betRequestLockRef.current = true
    placingRef.current = true
    setBusy(true)
    androidRollDebug('start', { action: 'bet', bet })

    try {
      const result = await placeRollBet({ bet })
      if (!result.success) {
        showNotification({
          type: 'warning',
          title: addMode ? 'Пополнение не принято' : 'Ставка не принята',
          message: result.message || 'Попробуйте ещё раз.',
        })
        androidRollDebug('error', { code: result.code, action: 'bet' })
      } else {
        androidRollDebug('roll created', {
          roundId: result.round?.id,
          status: result.round?.status,
          players: result.round?.players?.length || 0,
        })
        applyBackendState(result, { fromBet: true })
        if (result.round?.id) {
          setActiveId(result.round.id)
        }
        syncBetValue(Math.min(Math.max(amountFloor, minBet), Math.max(amountFloor, amount)))
        // Immediate resync — do not trust a single response body on Android WebView.
        void syncFromBackend('post-bet')
      }
    } catch (error) {
      androidRollDebug('error', { action: 'bet', message: 'unexpected' })
      console.warn('[ANDROID-ROLL] bet unexpected', error)
      showNotification({
        type: 'warning',
        title: addMode ? 'Пополнение не принято' : 'Ставка не принята',
        message: 'Не удалось отправить ставку. Попробуйте ещё раз.',
      })
    } finally {
      placingRef.current = false
      setBusy(false)
      betRequestLockRef.current = false
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
    phase,
    syncError,
    retrySync,
    activeRoundId,
  }
}
