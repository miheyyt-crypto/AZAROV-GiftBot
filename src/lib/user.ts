import { getBalance } from '@/lib/balance'
import {
  getTelegramUserUnsafe,
  isTelegramEnvironment,
} from '@/lib/telegram'
import type { TelegramUser, UserProfile, UserStats } from '@/types'

const DEMO_USER: TelegramUser = {
  id: 0,
  first_name: 'Михаил',
  username: 'demo_user',
  isDemo: true,
}

const MOCK_LEVEL = 0
const MOCK_XP = 0
const MOCK_NEXT_LEVEL_XP = 1500

const MOCK_STATS: UserStats = {
  streamHours: 0,
  chatMessages: 0,
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
  if (!isTelegramEnvironment()) {
    return DEMO_USER
  }

  const rawUser = getTelegramUserUnsafe()

  if (!rawUser) {
    return DEMO_USER
  }

  return mapTelegramUser(rawUser)
}

export function getUserProfile(): UserProfile {
  return {
    user: getTelegramUser(),
    balance: getBalance(),
    level: MOCK_LEVEL,
    xp: MOCK_XP,
    nextLevelXp: MOCK_NEXT_LEVEL_XP,
  }
}

export function getUserStats(): UserStats {
  return { ...MOCK_STATS }
}

export function getDisplayName(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ')
}

export function getDisplayUsername(user: TelegramUser): string {
  if (user.username) {
    return `@${user.username}`
  }

  return '@username не указан'
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
