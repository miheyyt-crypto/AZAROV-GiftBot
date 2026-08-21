export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  language_code?: string
  is_premium?: boolean
  isDemo: boolean
}

export interface UserBalance {
  amount: number
  currency: 'coins'
}

export interface UserProfile {
  user: TelegramUser
  balance: UserBalance
  level: number
  xp: number
  nextLevelXp: number
}

export interface UserStats {
  streamHours: number
  chatMessages: number
}

export interface KickUser {
  id: string
  username: string
}

export interface KickConnection {
  connected: boolean
  username?: string
  userId?: string
}
