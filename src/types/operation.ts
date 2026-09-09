export type Currency = 'COINS' | 'RUB'

/** Mirrors server TX_TYPE from store.coinTransactions. */
export type OperationType =
  | 'task_reward'
  | 'referral_reward'
  | 'partner_reward'
  | 'case_reward'
  | 'case_purchase'
  | 'shop_purchase'
  | 'mines_bet'
  | 'mines_win'
  | 'admin_adjustment'
  | 'refund'
  | string

export type OperationStatus = 'completed' | 'pending' | 'failed'

export type OperationFilter = 'all' | 'income' | 'purchases' | 'rewards'

export interface Operation {
  id: string
  type: OperationType
  title: string
  description: string
  /** Signed ledger amount: >0 credit, <0 debit. */
  amount: number
  currency: Currency
  status: OperationStatus
  createdAt: string
  balanceAfter?: number | null
  /** Optional emoji / icon hint for UI */
  icon?: string
}

export const OPERATION_PURCHASE_TYPES: ReadonlySet<string> = new Set([
  'case_purchase',
  'shop_purchase',
  'mines_bet',
])

export const OPERATION_REWARD_TYPES: ReadonlySet<string> = new Set([
  'task_reward',
  'referral_reward',
  'partner_reward',
  'case_reward',
  'giveaway_reward',
  'achievement_reward',
  'mines_win',
])

/** Ledger amounts are already signed. */
export function isOperationIncome(operation: Operation): boolean {
  return Number(operation.amount) >= 0
}

export function getSignedOperationAmount(operation: Operation): number {
  return Number(operation.amount) || 0
}

export function iconForOperationType(type: string, income: boolean): string {
  switch (type) {
    case 'referral_reward':
      return '👥'
    case 'partner_reward':
      return '💰'
    case 'task_reward':
      return '🎮'
    case 'giveaway_reward':
      return '🎁'
    case 'case_reward':
      return '🎉'
    case 'case_purchase':
      return '🎁'
    case 'shop_purchase':
      return '🛒'
    case 'mines_bet':
      return '💣'
    case 'mines_win':
      return '💎'
    case 'refund':
      return '♻️'
    case 'admin_adjustment':
      return '⚙️'
    default:
      return income ? '🪙' : '💸'
  }
}
