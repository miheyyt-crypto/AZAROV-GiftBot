import type { CaseRewardRarity } from '@/types/case'

export type LeaderboardMetric = 'balance' | 'referrals'

export interface LeaderboardPlayer {
  rank: number
  username: string
  displayName: string
  photoUrl: string
  balance: number
  invitedCount?: number
  level?: number
  isMe?: boolean
  inTop?: boolean
}

export interface RecentCaseDrop {
  id: string
  username: string
  displayName: string
  photoUrl: string
  prizeName: string
  prizeAmount: number
  prizeCurrency: 'RUB' | 'COINS'
  rarity: CaseRewardRarity
  createdAt: string
}
