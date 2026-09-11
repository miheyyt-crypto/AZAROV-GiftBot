/**
 * Pure Android Roll runtime helpers (no DOM / Telegram imports).
 * Tested from Node via --experimental-strip-types.
 */

export type AndroidRollPhase = 'idle' | 'placing' | 'waiting' | 'result' | 'error'

export type AndroidRuntimeHints = {
  platform: string
  telegramWebApp: boolean
  /** navigator.userAgent — secondary signal only. */
  userAgent: string
}

const ANDROID_TG = new Set(['android', 'android_x'])

export function isAndroidTelegramFromHints(hints: AndroidRuntimeHints): boolean {
  const platform = String(hints.platform || '').toLowerCase()
  if (ANDROID_TG.has(platform) && hints.telegramWebApp) {
    return true
  }
  // Some Android Telegram builds report weba/webk with Android UA.
  if (
    hints.telegramWebApp &&
    /android/i.test(hints.userAgent || '') &&
    (platform === 'weba' || platform === 'webk' || platform === 'web')
  ) {
    return true
  }
  return false
}

export type AndroidRoundLike = {
  id: string
  status: string
  players?: unknown[]
  winnerUserId?: number | null
  winner?: unknown | null
  spinStartedAt?: string | null
  spinEndsAt?: string | null
  targetAngle?: number | null
}

/** Map backend round → simple Android UI phase (animation never drives this). */
export function resolveAndroidPhase(input: {
  placing: boolean
  syncError: boolean
  viewerInRound: boolean
  activeRoundId: string | null
  round: AndroidRoundLike | null
  nowMs: number
  skewMs: number
  revealAfterMs: number
}): AndroidRollPhase {
  if (input.placing) {
    return 'placing'
  }
  if (input.syncError) {
    return 'error'
  }
  const round = input.round
  if (!round) {
    return 'idle'
  }

  const hasWinner = round.winnerUserId != null && Boolean(round.winner)
  if (round.status === 'completed' && hasWinner) {
    return 'result'
  }
  if ((round.status === 'spinning' || round.status === 'locked') && hasWinner) {
    const started = Date.parse(round.spinStartedAt || '')
    if (Number.isFinite(started)) {
      const revealAt = started - input.skewMs + input.revealAfterMs
      if (input.nowMs >= revealAt) {
        return 'result'
      }
    }
    return 'waiting'
  }

  if (
    input.viewerInRound ||
    (input.activeRoundId && input.activeRoundId === round.id) ||
    round.status === 'betting' ||
    round.status === 'locked' ||
    round.status === 'spinning' ||
    ((round.players?.length || 0) > 0 && round.status === 'waiting')
  ) {
    return 'waiting'
  }

  return 'idle'
}

export type AndroidPoller = {
  start: (getDelayMs: () => number) => void
  stop: () => void
  kick: (reason?: string) => void
  isInFlight: () => boolean
  startedCount: () => number
  generation: () => number
}

/** Single-flight recursive setTimeout poller — no setInterval. */
export function createAndroidRollPoller(options: {
  poll: () => Promise<void>
  onDebug?: (event: string, details?: Record<string, unknown>) => void
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void
}): AndroidPoller {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const debug = options.onDebug

  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false
  let pendingKick = false
  let stopped = true
  let getDelayMs: (() => number) | null = null
  let started = 0
  let gen = 0

  const clearTimer = () => {
    if (timer != null) {
      clearTimeoutFn(timer)
      timer = null
    }
  }

  const schedule = (g: number) => {
    if (stopped || g !== gen || !getDelayMs) {
      return
    }
    clearTimer()
    const ms = Math.max(400, Number(getDelayMs()) || 1_500)
    timer = setTimeoutFn(() => {
      timer = null
      void run(g)
    }, ms)
  }

  const run = async (g: number) => {
    if (stopped || g !== gen) {
      return
    }
    if (inFlight) {
      pendingKick = true
      return
    }
    inFlight = true
    started += 1
    debug?.('polling', { generation: g, n: started })
    try {
      await options.poll()
    } finally {
      inFlight = false
      if (stopped || g !== gen) {
        return
      }
      if (pendingKick) {
        pendingKick = false
        void run(g)
        return
      }
      schedule(g)
    }
  }

  return {
    start(nextGetDelay) {
      getDelayMs = nextGetDelay
      if (!stopped) {
        return
      }
      stopped = false
      gen += 1
      const g = gen
      debug?.('poll start', { generation: g })
      void run(g)
    },
    stop() {
      stopped = true
      gen += 1
      pendingKick = false
      clearTimer()
      debug?.('cleanup')
    },
    kick(reason = 'kick') {
      debug?.(reason)
      if (stopped) {
        return
      }
      const g = gen
      if (inFlight) {
        pendingKick = true
        return
      }
      clearTimer()
      void run(g)
    },
    isInFlight: () => inFlight,
    startedCount: () => started,
    generation: () => gen,
  }
}

export const ANDROID_ROLL_ACTIVE_KEY = 'azarov_android_active_roll'
export const ANDROID_POLL_MS_ACTIVE = 1_200
export const ANDROID_POLL_MS_IDLE = 3_500
export const ANDROID_SYNC_FAIL_LIMIT = 6
