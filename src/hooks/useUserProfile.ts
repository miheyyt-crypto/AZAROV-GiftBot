import { useMemo } from 'react'

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

  const user = useMemo(() => getTelegramUser(), [isAvailable])
  const profile = useMemo(() => getUserProfile(), [isAvailable])
  const stats = useMemo(() => getUserStats(), [isAvailable])

  return {
    user,
    profile,
    stats,
    isTelegram: isAvailable && !user.isDemo,
    isDemo: user.isDemo,
    displayName: getDisplayName(user),
    displayUsername: getDisplayUsername(user),
  }
}
