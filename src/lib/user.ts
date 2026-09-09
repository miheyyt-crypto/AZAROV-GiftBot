import { getBalance } from '@/lib/balance'
import { getWebAuthUser } from '@/lib/auth'
import { getCurrentAccount } from '@/lib/account'
import {
  getTelegramUserUnsafe,
  isTelegramEnvironment,
  getTelegramInitData,
} from '@/lib/telegram'
import type { TelegramUser, UserProfile, UserStats } from '@/types'

const DEMO_USER: TelegramUser = {
  id: 0,
  first_name: 'Гость',
  username: undefined,
  isDemo: true,
}

export function formatWatchDuration(watchSeconds: number): string {
  const total = Math.max(0, Math.floor(Number(watchSeconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (hours <= 0) {
    return `${minutes} мин`
  }
  if (minutes <= 0) {
    return `${hours} ч`
  }
  return `${hours} ч ${minutes} мин`
}

function mapTelegramUser(raw: NonNullable<ReturnType<typeof getTelegramUserUnsafe>>): TelegramUser {
  return {
    id: raw.id,
    first_name: raw.first_name,
    last_name: raw.last_name,
    username: raw.username,
    photo_url: raw.photo_url,
    language_code: raw.language_code,
    is_premium: raw.is_premium,
    isDemo: false,
  }
}

export function getTelegramUser(): TelegramUser {
  // Website session (Login Widget) takes priority outside Mini App initData.
  const webUser = getWebAuthUser()
  if (webUser && webUser.id > 0 && !webUser.isDemo) {
    return webUser
  }

  if (isTelegramEnvironment() && getTelegramInitData()) {
    const rawUser = getTelegramUserUnsafe()
    if (rawUser) {
      return mapTelegramUser(rawUser)
    }
  }

  return DEMO_USER
}

export function getUserProfile(): UserProfile {
  const account = getCurrentAccount()
  return {
    user: getTelegramUser(),
    balance: getBalance(),
    level: Math.max(1, Number(account.level) || 1),
    xp: Math.max(0, Number(account.xp) || 0),
    nextLevelXp: Math.max(1, Number(account.xpForNextLevel) || 200),
    currentLevelXp: Math.max(0, Number(account.xpForCurrentLevel) || 0),
  }
}

export function getUserStats(): UserStats {
  const account = getCurrentAccount()
  const watchSeconds = Math.max(0, Number(account.watchSeconds) || 0)
  const chatMessages = Math.max(0, Number(account.chatMessages) || 0)
  return {
    streamHours: Math.max(0, Number(account.streamHours) || Math.floor(watchSeconds / 3600)),
    chatMessages,
    watchSeconds,
    watchLabel: formatWatchDuration(watchSeconds),
  }
}

export function getDisplayName(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Игрок'
}

export function getDisplayUsername(user: TelegramUser): string {
  if (user.username) {
    return `@${user.username}`
  }

  return 'Имя пользователя не указано'
}

export function getHeaderDisplayName(user: TelegramUser): string {
  if (user.username) {
    return `@${user.username}`
  }

  return getDisplayName(user)
}

export function getUserInitial(user: TelegramUser): string {
  const name = user.first_name?.trim()
  if (!name) {
    return '?'
  }

  return name.charAt(0).toUpperCase()
}
