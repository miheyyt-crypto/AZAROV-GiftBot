import type { TelegramWebApp, TelegramWebAppUser } from '@/types'

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
  'ipad', // keep iPad on document-scroll path (Safari rubber-band)
])

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

  // Do not call ready() here with side effects that depend on unread launch params —
  // callers should capture start_param first via captureStartParam().
  webApp.ready()
  webApp.expand()
  bootstrapViewportEnvironment(webApp)

  const anyApp = webApp as TelegramWebApp & {
    onEvent?: (event: string, cb: () => void) => void
  }
  if (typeof anyApp.onEvent === 'function') {
    const resync = () => bootstrapViewportEnvironment(webApp)
    anyApp.onEvent('viewportChanged', resync)
    anyApp.onEvent('safeAreaChanged', resync)
    anyApp.onEvent('contentSafeAreaChanged', resync)
  }

  return webApp
}

/**
 * Desktop (Telegram Desktop / desktop browser): #root is the ONLY vertical scroll
 * container — the outer iframe / window clips document scroll.
 * Mobile (iOS/Android): keep natural document scroll (do NOT add app-desktop-embed).
 */
export function bootstrapViewportEnvironment(webApp: TelegramWebApp | null = getTelegramWebApp()): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return
  }

  const root = document.documentElement
  const platform = String(webApp?.platform || getTelegramPlatform() || 'browser').toLowerCase()
  const finePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches

  const isMobileTg = MOBILE_TG_PLATFORMS.has(platform)
  const isHardDesktopTg = HARD_DESKTOP_TG_PLATFORMS.has(platform)

  /*
   * CRITICAL (eda9ee3 miss):
   * telegram-web-app.js often reports platform "unknown" when WebApp exists.
   * Old logic required platform==="browser" | !webApp for fine-pointer path →
   * desktop scroll NEVER activated → Header/Stats stuck above fold.
   *
   * Rule: never on ios/android; always on tdesktop/macos/linux; otherwise any
   * fine pointer (mouse/trackpad) including platform "unknown" / "web".
   */
  const useDesktopScroll = !isMobileTg && (isHardDesktopTg || finePointer)

  root.classList.toggle('app-desktop-embed', useDesktopScroll)

  if (useDesktopScroll) {
    // Desktop must not inherit phone notch insets from Telegram APIs.
    root.style.setProperty('--safe-area-top', '0px')
    root.style.setProperty('--safe-area-bottom', '0px')
  } else {
    syncTelegramSafeArea(webApp)
  }

  syncDesktopViewportHeight(webApp)
}

/** Scrollport for desktop embed (#root). Null on mobile document-scroll path. */
export function getAppScrollRoot(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }
  if (!document.documentElement.classList.contains('app-desktop-embed')) {
    return null
  }
  return document.getElementById('root')
}

import { withScrollResetMarker } from '@/lib/roll-scroll-debug'

/** Reset scroll so route changes / late layout do not leave Header above the fold. */
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

function syncDesktopViewportHeight(webApp: TelegramWebApp | null): void {
  const root = document.documentElement
  if (!root.classList.contains('app-desktop-embed')) {
    root.style.removeProperty('--tg-viewport-stable-height')
    return
  }

  const vv = window.visualViewport?.height
  const winH = typeof vv === 'number' && vv > 0 ? vv : window.innerHeight
  const tgH =
    webApp && Number(webApp.viewportStableHeight) > 0
      ? Number(webApp.viewportStableHeight)
      : webApp && Number(webApp.viewportHeight) > 0
        ? Number(webApp.viewportHeight)
        : 0

  // Prefer the smaller positive height — TG sometimes reports a taller value than
  // the visible Mini App iframe, which freezes mid-page content outside the iframe.
  const candidates = [tgH, winH].filter((n) => Number.isFinite(n) && n > 0)
  const h = candidates.length ? Math.min(...candidates) : winH
  if (h > 0) {
    root.style.setProperty('--tg-viewport-stable-height', `${Math.round(h)}px`)
  }
}

/** Prefer Telegram content/safe insets when env(safe-area-*) is 0 in WebView. */
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
    // Cap absurd insets (some Desktop builds report large title-bar values).
    if (top > 0 && top < 120) {
      root.style.setProperty('--safe-area-top', `${top}px`)
    }
    if (bottom > 0 && bottom < 80) {
      root.style.setProperty('--safe-area-bottom', `${bottom}px`)
    }
  } catch {
    // ignore — CSS env() fallback remains
  }
}

export function getTelegramPlatform(): string {
  return getTelegramWebApp()?.platform ?? 'browser'
}

export function getTelegramColorScheme(): 'light' | 'dark' {
  return getTelegramWebApp()?.colorScheme ?? 'dark'
}
