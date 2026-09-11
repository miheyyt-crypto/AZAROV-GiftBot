import { getTelegramPlatform, getTelegramWebApp, isTelegramWebApp } from '@/lib/telegram'
import {
  createRollPollScheduler as createCorePollScheduler,
  requiresRollRuntimeRecoveryFrom,
  shouldPauseRollPollingWhenHiddenFrom,
  type RollPollScheduler,
  type RollRuntimeHints,
} from '@/lib/roll-runtime-core'

export type { RollPollScheduler, RollRuntimeHints }
export { requiresRollRuntimeRecoveryFrom, shouldPauseRollPollingWhenHiddenFrom }

function hasCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

export function readRollRuntimeHints(): RollRuntimeHints {
  return {
    platform: String(getTelegramPlatform() || 'browser').toLowerCase(),
    coarsePointer: hasCoarsePointer(),
    telegramWebApp: isTelegramWebApp(),
  }
}

export function requiresRollRuntimeRecovery(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return requiresRollRuntimeRecoveryFrom(readRollRuntimeHints())
}

export function shouldPauseRollPollingWhenHidden(): boolean {
  if (typeof window === 'undefined') {
    return true
  }
  return shouldPauseRollPollingWhenHiddenFrom(readRollRuntimeHints())
}

/** Explicit alias for Telegram mobile / phone WebView detection. */
export function isTelegramMobileWebView(): boolean {
  return requiresRollRuntimeRecovery()
}

export function isRollDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    if (window.localStorage?.getItem('ROLL_DEBUG') === '1') {
      return true
    }
  } catch {
    // ignore
  }
  return String(import.meta.env.VITE_ROLL_DEBUG || '') === '1'
}

export function rollDebug(event: string, details?: Record<string, unknown>): void {
  if (!isRollDebugEnabled()) {
    return
  }
  if (details) {
    console.info(`[ROLL] ${event}`, details)
  } else {
    console.info(`[ROLL] ${event}`)
  }
}

export function createRollPollScheduler(options: {
  poll: () => Promise<void>
  shouldSkipTick?: () => boolean
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void
}): RollPollScheduler {
  return createCorePollScheduler({
    ...options,
    onDebug: rollDebug,
  })
}

/**
 * Subscribe to Telegram + DOM resume signals; returns cleanup.
 * Only uses viewportChanged (already used in this project) plus DOM events.
 */
export function subscribeRollResume(onResume: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }

  let lastAt = 0
  const DEBOUNCE_MS = 400
  const fire = () => {
    const now = Date.now()
    if (now - lastAt < DEBOUNCE_MS) {
      return
    }
    lastAt = now
    onResume()
  }

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      rollDebug('visibility visible')
      fire()
    } else {
      rollDebug('visibility hidden')
    }
  }
  const handleFocus = () => {
    rollDebug('focus')
    fire()
  }
  const handlePageShow = () => {
    rollDebug('pageshow')
    fire()
  }

  document.addEventListener('visibilitychange', handleVisibility)
  window.addEventListener('focus', handleFocus)
  window.addEventListener('pageshow', handlePageShow)

  const webApp = getTelegramWebApp() as
    | (ReturnType<typeof getTelegramWebApp> & {
        onEvent?: (event: string, cb: () => void) => void
        offEvent?: (event: string, cb: () => void) => void
      })
    | null

  const tgResume = () => {
    rollDebug('telegram viewportChanged')
    fire()
  }

  if (webApp && typeof webApp.onEvent === 'function') {
    webApp.onEvent('viewportChanged', tgResume)
  }

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility)
    window.removeEventListener('focus', handleFocus)
    window.removeEventListener('pageshow', handlePageShow)
    if (webApp && typeof webApp.offEvent === 'function') {
      webApp.offEvent('viewportChanged', tgResume)
    }
  }
}
