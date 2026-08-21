import type { CaseRewardRarity } from '@/types/case'

export interface LeaderboardPlayer {
  rank: number
  username: string
  displayName: string
  photoUrl: string
  balance: number
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
