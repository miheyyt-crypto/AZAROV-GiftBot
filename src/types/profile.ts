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

/** Prize from a case opening (legacy inventory list). */
export interface CaseOpeningItem {
  id: string
  name: string
  amount: number
  currency: 'RUB' | 'COINS'
  caseId: string
  caseName: string
  rarity: string
  createdAt: string
}

/** Real inventory item (shop fulfillment after admin approve). */
export interface InventoryItem {
  itemId: string
  type: string
  status: 'available' | 'consumed' | string
  /** Stack count for stackable items (e.g. available streak-freeze). */
  quantity?: number
  sourceOrderId?: string | null
  createdAt: string
  consumedAt?: string | null
  name: string
  metadata?: Record<string, unknown>
}

/** @deprecated Prefer CaseOpeningItem — kept for older call sites. */
export type LegacyCaseInventoryItem = CaseOpeningItem

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
  /** in_progress | claimable | claimed */
  status?: 'in_progress' | 'claimable' | 'claimed' | string
}

export type ProfileMenuId =
  | 'coin-history'
  | 'operations'
  | 'inventory'
  | 'orders'
  | 'achievements'
  | 'logout'
