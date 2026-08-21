import { useEffect, useState } from 'react'

import {
  getTelegramColorScheme,
  getTelegramPlatform,
  getTelegramWebApp,
  initTelegramWebApp,
  isTelegramWebApp,
} from '@/lib/telegram'
import type { TelegramWebApp } from '@/types'

interface TelegramWebAppState {
  webApp: TelegramWebApp | null
  isAvailable: boolean
  platform: string
  colorScheme: 'light' | 'dark'
}

export function useTelegramWebApp(): TelegramWebAppState {
  const [state, setState] = useState<TelegramWebAppState>(() => ({
    webApp: getTelegramWebApp(),
    isAvailable: isTelegramWebApp(),
    platform: getTelegramPlatform(),
    colorScheme: getTelegramColorScheme(),
  }))

  useEffect(() => {
    const webApp = initTelegramWebApp()

    setState({
      webApp,
      isAvailable: webApp !== null,
      platform: getTelegramPlatform(),
      colorScheme: getTelegramColorScheme(),
    })
  }, [])

  return state
}
