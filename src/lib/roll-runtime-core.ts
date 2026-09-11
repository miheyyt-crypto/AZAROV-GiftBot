/**
 * Pure Roll runtime helpers (no Telegram / DOM imports).
 * Safe to unit-test from Node via --experimental-strip-types.
 */

const MOBILE_TG = new Set(['ios', 'android', 'android_x', 'iphone', 'ipad'])
const WEB_TG = new Set(['weba', 'webk', 'web'])

export type RollRuntimeHints = {
  platform: string
  coarsePointer: boolean
  /** True when running inside Telegram.WebApp shell. */
  telegramWebApp: boolean
}

/**
 * Telegram mobile WebViews (native + phone WebA/WebK) need recovery because
 * document.hidden / SSE / rAF are unreliable there.
 */
export function requiresRollRuntimeRecoveryFrom(hints: RollRuntimeHints): boolean {
  const platform = String(hints.platform || '').toLowerCase()
  if (MOBILE_TG.has(platform)) {
    return true
  }
  if (WEB_TG.has(platform) && hints.coarsePointer) {
    return true
  }
  // Coarse Telegram shell with unknown platform string (some Android builds).
  if (hints.telegramWebApp && hints.coarsePointer) {
    return true
  }
  return false
}

/**
 * Pausing polls on document.hidden is safe on desktop browsers.
 * On Telegram Android/iOS, visibilityState is often wrong while the Mini App
 * is still on screen — pausing freezes Roll on «Ожидание».
 */
export function shouldPauseRollPollingWhenHiddenFrom(hints: RollRuntimeHints): boolean {
  return !requiresRollRuntimeRecoveryFrom(hints)
}

export type RollPollScheduler = {
  start: (getIntervalMs: () => number) => void
  stop: () => void
  /** Force a poll now (visibility/focus/remount). Single-flight. */
  recover: (reason?: string) => void
  isInFlight: () => boolean
  /** Test helper: how many poll() invocations started. */
  startedCount: () => number
}

/**
 * Controlled recursive polling with single-flight lock.
 * Prevents duplicate loops after multiple focus/visibility events.
 */
export function createRollPollScheduler(options: {
  poll: () => Promise<void>
  shouldSkipTick?: () => boolean
  onDebug?: (event: string, details?: Record<string, unknown>) => void
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void
}): RollPollScheduler {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const debug = options.onDebug

  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false
  let pendingRecover = false
  let stopped = true
  let getIntervalMs: (() => number) | null = null
  let started = 0
  let generation = 0

  const clearTimer = () => {
    if (timer != null) {
      clearTimeoutFn(timer)
      timer = null
    }
  }

  const scheduleNext = (gen: number) => {
    if (stopped || gen !== generation || !getIntervalMs) {
      return
    }
    clearTimer()
    const ms = Math.max(250, Number(getIntervalMs()) || 1_000)
    timer = setTimeoutFn(() => {
      timer = null
      void tick(gen)
    }, ms)
  }

  const tick = async (gen: number) => {
    if (stopped || gen !== generation) {
      return
    }
    if (options.shouldSkipTick?.()) {
      scheduleNext(gen)
      return
    }
    if (inFlight) {
      pendingRecover = true
      return
    }
    inFlight = true
    started += 1
    try {
      await options.poll()
    } finally {
      inFlight = false
      if (stopped || gen !== generation) {
        return
      }
      if (pendingRecover) {
        pendingRecover = false
        void tick(gen)
        return
      }
      scheduleNext(gen)
    }
  }

  return {
    start(nextGetIntervalMs) {
      getIntervalMs = nextGetIntervalMs
      if (!stopped) {
        return
      }
      stopped = false
      generation += 1
      const gen = generation
      debug?.('poll start')
      void tick(gen)
    },
    stop() {
      stopped = true
      generation += 1
      pendingRecover = false
      clearTimer()
      debug?.('cleanup')
    },
    recover(reason = 'recover') {
      debug?.(reason)
      if (stopped) {
        return
      }
      const gen = generation
      if (inFlight) {
        pendingRecover = true
        return
      }
      clearTimer()
      void tick(gen)
    },
    isInFlight: () => inFlight,
    startedCount: () => started,
  }
}
