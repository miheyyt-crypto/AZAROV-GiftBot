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
  /** Current completed streak days (e.g. 2 in 2/3). */
  progressCurrent?: number
  /** Next milestone day (e.g. 3 in 2/3). */
  progressRequired?: number
  /** Coins for the next streak day (display). */
  nextReward?: number
  /** Required Kick channel is live right now. */
  isLive?: boolean
  channelSlug?: string
  /** Kick channel (streamer) avatar URL. */
  channelAvatarUrl?: string | null
}
