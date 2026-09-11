import {
  getTelegramPlatform,
  getTelegramWebApp,
  isTelegramWebApp,
} from '@/lib/telegram'
import {
  isAndroidTelegramFromHints,
  type AndroidRuntimeHints,
} from '@/lib/android-roll-runtime-core'

export {
  ANDROID_POLL_MS_ACTIVE,
  ANDROID_POLL_MS_IDLE,
  ANDROID_ROLL_ACTIVE_KEY,
  ANDROID_SYNC_FAIL_LIMIT,
  createAndroidRollPoller,
  resolveAndroidPhase,
  isAndroidTelegramFromHints,
  type AndroidRollPhase,
  type AndroidPoller,
} from '@/lib/android-roll-runtime-core'

function readHints(): AndroidRuntimeHints {
  const ua =
    typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : ''
  return {
    platform: String(getTelegramPlatform() || 'browser').toLowerCase(),
    telegramWebApp: isTelegramWebApp(),
    userAgent: ua,
  }
}

/** Android Telegram Mini App only — not Chrome, not iOS, not desktop. */
export function isAndroidTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return isAndroidTelegramFromHints(readHints())
}

export function isAndroidRollDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    if (window.localStorage?.getItem('ROLL_ANDROID_DEBUG') === '1') {
      return true
    }
  } catch {
    // ignore
  }
  return String(import.meta.env.VITE_ROLL_ANDROID_DEBUG || '') === '1'
}

export function androidRollDebug(
  event: string,
  details?: Record<string, unknown>,
): void {
  if (!isAndroidRollDebugEnabled()) {
    return
  }
  if (details) {
    console.info(`[ANDROID-ROLL] ${event}`, details)
  } else {
    console.info(`[ANDROID-ROLL] ${event}`)
  }
}

export function readActiveAndroidRollId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const raw = window.sessionStorage.getItem('azarov_android_active_roll')
    return raw && raw.length > 0 ? raw : null
  } catch {
    return null
  }
}

export function writeActiveAndroidRollId(roundId: string | null): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    if (!roundId) {
      window.sessionStorage.removeItem('azarov_android_active_roll')
    } else {
      window.sessionStorage.setItem('azarov_android_active_roll', roundId)
    }
  } catch {
    // ignore
  }
}

/** DOM + Telegram viewport resume (no invented events). */
export function subscribeAndroidRollResume(onResume: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }

  let lastAt = 0
  const fire = () => {
    const now = Date.now()
    if (now - lastAt < 350) {
      return
    }
    lastAt = now
    androidRollDebug('recovery')
    onResume()
  }

  const onVis = () => {
    androidRollDebug('visibility', { state: document.visibilityState })
    if (document.visibilityState === 'visible') {
      fire()
    }
  }
  const onFocus = () => fire()
  const onPageShow = () => fire()

  document.addEventListener('visibilitychange', onVis)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pageshow', onPageShow)

  const webApp = getTelegramWebApp() as
    | (ReturnType<typeof getTelegramWebApp> & {
        onEvent?: (event: string, cb: () => void) => void
        offEvent?: (event: string, cb: () => void) => void
      })
    | null

  const onViewport = () => fire()
  if (webApp && typeof webApp.onEvent === 'function') {
    webApp.onEvent('viewportChanged', onViewport)
  }

  return () => {
    document.removeEventListener('visibilitychange', onVis)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pageshow', onPageShow)
    if (webApp && typeof webApp.offEvent === 'function') {
      webApp.offEvent('viewportChanged', onViewport)
    }
  }
}
