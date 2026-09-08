export type CaseType = 'purchase' | 'referral'

export type CaseRewardCurrency = 'RUB' | 'COINS'

export type CaseRewardRarity = 'legendary' | 'epic' | 'rare' | 'common'

export interface CaseReward {
  id: string
  name: string
  amount: number
  currency: CaseRewardCurrency
  rarity: CaseRewardRarity
  chance: number
  image: string
}

export interface GiftCase {
  id: string
  name: string
  description: string
  image: string
  maxPrize?: string
  subtitle?: string
  price?: number
  type: CaseType
  borderClass: string
  rewards: CaseReward[]
}

export interface CasePrize {
  id: string
  name: string
  title?: string
  amount: number
  currency: CaseRewardCurrency
  rarity: CaseRewardRarity
}

export interface CaseOpening {
  openingId: string
  caseId: string
  rewardId: string
  rewardAmount: number
  rewardCurrency: CaseRewardCurrency
  pricePaid: number
  prize: CasePrize
  createdAt: string
}

export interface ReferralCaseStats {
  invitedCount: number
  confirmedReferrals: number
  currentProgress: number
  progressTarget: number
  earnedReferralCases: number
  openedReferralCases: number
  availableReferralCases: number
  remainingInvites: number
}

export const RARITY_LABELS: Record<CaseRewardRarity, string> = {
  legendary: 'Легендарный',
  epic: 'Эпический',
  rare: 'Редкий',
  common: 'Обычный',
}
