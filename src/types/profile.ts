export type CoinHistoryFilter = 'all' | 'income' | 'expense'

export interface CoinTransaction {
  id: string
  amount: number
  type: string
  label: string
  description?: string
  referenceId?: string | null
  balanceAfter?: number | null
  createdAt: string
}

export interface InventoryItem {
  id: string
  name: string
  amount: number
  currency: 'RUB' | 'COINS'
  caseId: string
  caseName: string
  rarity: string
  createdAt: string
}

export interface AchievementDefinition {
  id: string
  title: string
  reward: number
  target: number
  icon: 'clock' | 'message' | 'users' | 'coins'
}

export interface AchievementProgress extends AchievementDefinition {
  current: number
  completed: boolean
  claimed: boolean
}

export type ProfileMenuId =
  | 'coin-history'
  | 'operations'
  | 'inventory'
  | 'orders'
  | 'achievements'
  | 'logout'

