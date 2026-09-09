import { useEffect, useState } from 'react'

import { subscribeAccount } from '@/lib/account'
import { subscribeAuth } from '@/lib/auth'
import { useTelegramWebApp } from '@/hooks/useTelegramWebApp'
import {
  getDisplayName,
  getDisplayUsername,
  getTelegramUser,
  getUserProfile,
  getUserStats,
} from '@/lib/user'

export function useUserProfile() {
  const { isAvailable } = useTelegramWebApp()
  const [version, setVersion] = useState(0)

  useEffect(() => subscribeAuth(() => setVersion((value) => value + 1)), [])
  useEffect(() => subscribeAccount(() => setVersion((value) => value + 1)), [])

  // Re-read when Telegram WebApp readiness, web auth, or account snapshot changes.
  void version
  void isAvailable

  const user = getTelegramUser()
  const profile = getUserProfile()
  const stats = getUserStats()

  return {
    user,
    profile,
    stats,
    isTelegram: !user.isDemo && user.id > 0,
    isDemo: user.isDemo,
    displayName: getDisplayName(user),
    displayUsername: getDisplayUsername(user),
  }
}
