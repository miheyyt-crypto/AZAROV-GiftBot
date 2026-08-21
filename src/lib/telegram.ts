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

  webApp.ready()
  webApp.expand()

  return webApp
}

export function getTelegramPlatform(): string {
  return getTelegramWebApp()?.platform ?? 'browser'
}

export function getTelegramColorScheme(): 'light' | 'dark' {
  return getTelegramWebApp()?.colorScheme ?? 'dark'
}
