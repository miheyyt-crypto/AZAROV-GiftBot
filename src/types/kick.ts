export type { KickConnection, KickUser } from './user'

export type KickStreakInfo = {
  success: boolean
  kickConnected: boolean
  kickUsername?: string | null
  kickUserId?: string | null
  currentStreak: number
  lastActiveDate: string | null
  creditedToday: boolean
  todayDate?: string
  timezone?: string
  channel?: string
  message?: string | null
  freezeAvailable?: number
  freezeAutoConsume?: boolean
}

