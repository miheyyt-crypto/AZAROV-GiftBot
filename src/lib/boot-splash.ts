/**
 * Hides the early HTML boot splash (#azarov-boot-splash) once the app is ready.
 * Min display avoids flash; max display prevents infinite hang on API failure.
 */

const MIN_DISPLAY_MS = 650
const FADE_MS = 280
const MAX_DISPLAY_MS = 10_000

let readySignaled = false
let maxTimer: number | null = null

function splashShownAtMs(): number {
  const el = document.getElementById('azarov-boot-splash')
  const raw = el?.getAttribute('data-shown-at')
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function removeSplashElement(): void {
  const el = document.getElementById('azarov-boot-splash')
  if (!el) {
    return
  }
  el.setAttribute('aria-hidden', 'true')
  el.style.pointerEvents = 'none'
  el.classList.add('is-hiding')
  window.setTimeout(() => {
    el.remove()
  }, FADE_MS + 40)
}

/**
 * Call when critical UI path is ready (session confirmed, login shown, blocked, or fatal error).
 */
export function signalAppBootReady(): void {
  if (readySignaled) {
    return
  }
  readySignaled = true
  if (maxTimer != null) {
    window.clearTimeout(maxTimer)
    maxTimer = null
  }

  const elapsed = Date.now() - splashShownAtMs()
  const wait = Math.max(0, MIN_DISPLAY_MS - elapsed)
  window.setTimeout(removeSplashElement, wait)
}

/** Safety net — never leave splash forever if boot never signals. */
export function armBootSplashWatchdog(): void {
  if (maxTimer != null) {
    return
  }
  maxTimer = window.setTimeout(() => {
    signalAppBootReady()
  }, MAX_DISPLAY_MS)
}
