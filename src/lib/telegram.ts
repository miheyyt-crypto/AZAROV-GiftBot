import type { TelegramWebApp, TelegramWebAppUser } from '@/types'

import { withScrollResetMarker } from '@/lib/roll-scroll-debug'

const HARD_DESKTOP_TG_PLATFORMS = new Set([
  'tdesktop',
  'macos',
  'linux',
  'unigram',
])

const MOBILE_TG_PLATFORMS = new Set([
  'ios',
  'android',
  'android_x',
  'iphone',
  'ipad',
])

/** Telegram web clients that still run on phones — never treat as desktop scroll. */
const MOBILE_TG_WEB_PLATFORMS = new Set(['weba', 'webk', 'web'])

function hasCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

function hasFinePointerHover(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  )
}

/** True for Telegram Desktop / desktop browser — never for iOS/Android WebView. */
export function isDesktopRoll(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const platform = String(getTelegramPlatform() || 'browser').toLowerCase()
  if (MOBILE_TG_PLATFORMS.has(platform)) {
    return false
  }
  // Phone Telegram WebView / WebA sometimes reports weba|web — keep document scroll.
  if (MOBILE_TG_WEB_PLATFORMS.has(platform) && hasCoarsePointer()) {
    return false
  }
  // Unknown platform + coarse touch → mobile (do not enable desktop embed).
  if (hasCoarsePointer()) {
    return false
  }
  if (HARD_DESKTOP_TG_PLATFORMS.has(platform)) {
    return true
  }
  return hasFinePointerHover()
}

export function isTelegramWebApp(): boolean {
  return typeof window !== 'undefined' && Boolean(window.Telegram?.WebApp)
}

export function isTelegramEnvironment(): boolean {
  return isTelegramWebApp()
}

export function getTelegramInitData(): string {
  return getTelegramWebApp()?.initData ?? ''
}

export function getTelegramUserUnsafe(): TelegramWebAppUser | null {
  return getTelegramWebApp()?.initDataUnsafe.user ?? null
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (!isTelegramWebApp()) {
    return null
  }

  return window.Telegram!.WebApp
}

export function initTelegramWebApp(): TelegramWebApp | null {
  const webApp = getTelegramWebApp()

  if (!webApp) {
    bootstrapViewportEnvironment(null)
    return null
  }

  webApp.ready()
  webApp.expand()
  // Allow swipe-down to minimize/close Mini App (Android/iOS). Safe no-op if absent.
  const swipeApp = webApp as TelegramWebApp & {
    enableVerticalSwipes?: () => void
    isVerticalSwipesEnabled?: boolean
  }
  if (typeof swipeApp.enableVerticalSwipes === 'function') {
    swipeApp.enableVerticalSwipes()
  }
  bootstrapViewportEnvironment(webApp)

  const anyApp = webApp as TelegramWebApp & {
    onEvent?: (event: string, cb: () => void) => void
  }
  if (typeof anyApp.onEvent === 'function') {
    // Only re-apply class / safe-area — do NOT rewrite pixel heights (resets #root scrollTop).
    const resync = () => bootstrapViewportEnvironment(webApp)
    anyApp.onEvent('viewportChanged', resync)
    anyApp.onEvent('safeAreaChanged', resync)
    anyApp.onEvent('contentSafeAreaChanged', resync)
  }

  return webApp
}

/**
 * Desktop: #root is the only vertical scroller (see .app-desktop-embed CSS).
 * Mobile: natural document scroll — never add the class.
 */
export function bootstrapViewportEnvironment(webApp: TelegramWebApp | null = getTelegramWebApp()): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }

  const root = document.documentElement
  const useDesktopScroll = isDesktopRoll()

  root.classList.toggle('app-desktop-embed', useDesktopScroll)

  if (useDesktopScroll) {
    root.style.setProperty('--safe-area-top', '0px')
    root.style.setProperty('--safe-area-bottom', '0px')
    // Drop JS pixel height — it was thrashing on viewportChanged/resize and
    // resetting #root.scrollTop (HUD: 498→500 then back to 0). CSS 100dvh is enough
    // inside Telegram's iframe.
    root.style.removeProperty('--tg-viewport-stable-height')
    installDesktopRootWheelBridge()
  } else {
    syncTelegramSafeArea(webApp)
  }
}

export function getAppScrollRoot(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }
  if (!document.documentElement.classList.contains('app-desktop-embed')) {
    return null
  }
  return document.getElementById('root')
}

/** Reset scroll on route change only. */
export function resetAppScrollPosition(): void {
  withScrollResetMarker(() => {
    const root = document.getElementById('root')
    if (root) {
      root.scrollTop = 0
    }
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0)
    }
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = 0
    }
    if (document.body) {
      document.body.scrollTop = 0
    }
    document.documentElement.scrollTop = 0
  })
}

/**
 * Telegram Desktop WebView often delivers wheel to document/BODY while BODY is
 * overflow:hidden — so #root never moves despite scrollHeight > clientHeight.
 * Forward wheel deltas to #root (capture). Nested overflow lists still win first.
 */
let wheelBridgeInstalled = false

export function installDesktopRootWheelBridge(): void {
  if (wheelBridgeInstalled || typeof window === 'undefined') {
    return
  }
  wheelBridgeInstalled = true

  window.addEventListener(
    'wheel',
    (event) => {
      if (!document.documentElement.classList.contains('app-desktop-embed')) {
        return
      }
      if (event.ctrlKey) {
        return
      }

      const root = document.getElementById('root')
      if (!root || root.scrollHeight <= root.clientHeight + 1) {
        return
      }

      const path = event.composedPath()
      for (const node of path) {
        if (!(node instanceof HTMLElement)) {
          continue
        }
        if (node === root || node === document.body || node === document.documentElement) {
          break
        }
        const style = getComputedStyle(node)
        const oy = style.overflowY
        if (oy !== 'auto' && oy !== 'scroll') {
          continue
        }
        if (node.scrollHeight <= node.clientHeight + 1) {
          continue
        }
        const atTop = node.scrollTop <= 0 && event.deltaY < 0
        const atBottom =
          node.scrollTop + node.clientHeight >= node.scrollHeight - 1 && event.deltaY > 0
        if (!atTop && !atBottom) {
          // Nested scroller can consume this wheel.
          return
        }
      }

      const before = root.scrollTop
      root.scrollTop = before + event.deltaY
      if (root.scrollTop !== before) {
        event.preventDefault()
      }
    },
    { passive: false, capture: true },
  )
}

function syncTelegramSafeArea(webApp: TelegramWebApp | null): void {
  if (!webApp) {
    return
  }
  try {
    const root = document.documentElement
    const anyApp = webApp as TelegramWebApp & {
      contentSafeAreaInset?: { top?: number; bottom?: number }
      safeAreaInset?: { top?: number; bottom?: number }
    }
    const top = Math.max(
      Number(anyApp.contentSafeAreaInset?.top) || 0,
      Number(anyApp.safeAreaInset?.top) || 0,
    )
    const bottom = Math.max(
      Number(anyApp.contentSafeAreaInset?.bottom) || 0,
      Number(anyApp.safeAreaInset?.bottom) || 0,
    )
    if (top > 0 && top < 120) {
      root.style.setProperty('--safe-area-top', `${top}px`)
    }
    if (bottom > 0 && bottom < 80) {
      root.style.setProperty('--safe-area-bottom', `${bottom}px`)
    }
  } catch {
    // ignore
  }
}

export function getTelegramPlatform(): string {
  return getTelegramWebApp()?.platform ?? 'browser'
}

export function getTelegramColorScheme(): 'light' | 'dark' {
  return getTelegramWebApp()?.colorScheme ?? 'dark'
}
