import type { TelegramWebApp, TelegramWebAppUser } from '@/types'

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
    return null
  }

  // Do not call ready() here with side effects that depend on unread launch params —
  // callers should capture start_param first via captureStartParam().
  webApp.ready()
  webApp.expand()
  syncTelegramSafeArea(webApp)

  return webApp
}

/** Prefer Telegram content/safe insets when env(safe-area-*) is 0 in WebView. */
function syncTelegramSafeArea(webApp: TelegramWebApp): void {
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
    if (top > 0) {
      root.style.setProperty('--safe-area-top', `${top}px`)
    }
    if (bottom > 0) {
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
