import type { CaseRewardRarity } from '@/types/case'

export type LeaderboardMetric = 'balance' | 'referrals'

export type RecentDropKind = 'case' | 'mines' | 'roll'

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
  kind?: RecentDropKind
  username: string
  displayName: string
  photoUrl: string
  /** Case prize title, or formatted coin amount for game wins. */
  prizeName: string
  prizeAmount: number
  prizeCurrency: 'RUB' | 'COINS'
  rarity?: CaseRewardRarity
  /** e.g. "Выиграл в mines" / "Выиграл в roll" */
  title?: string
  /** e.g. "х1.21" / "шанс 91%" */
  metaLabel?: string
  createdAt: string
}
