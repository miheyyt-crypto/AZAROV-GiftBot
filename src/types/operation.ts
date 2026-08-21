export type Currency = 'COINS' | 'RUB'

export type OperationType =
  | 'referral_reward'
  | 'task_reward'
  | 'case_purchase'
  | 'case_reward'
  | 'order_purchase'
  | 'order_refund'
  | 'bonus'
  | 'withdrawal'
  | 'correction'

export type OperationStatus = 'completed' | 'pending' | 'failed'

export type OperationFilter = 'all' | 'income' | 'purchases' | 'rewards'

export interface Operation {
  id: string
  type: OperationType
  title: string
  description: string
  amount: number
  currency: Currency
  status: OperationStatus
  createdAt: string
  /** Optional emoji / icon hint for UI */
  icon?: string
}

/** Positive / negative is derived from type (and amount sign for corrections). */
export const OPERATION_INCOME_TYPES: ReadonlySet<OperationType> = new Set([
  'referral_reward',
  'task_reward',
  'case_reward',
  'order_refund',
  'bonus',
])

export const OPERATION_PURCHASE_TYPES: ReadonlySet<OperationType> = new Set([
  'case_purchase',
  'order_purchase',
  'withdrawal',
])

export const OPERATION_REWARD_TYPES: ReadonlySet<OperationType> = new Set([
  'referral_reward',
  'task_reward',
  'case_reward',
  'bonus',
])

export function isOperationIncome(operation: Operation): boolean {
  if (operation.type === 'correction') {
    return operation.amount >= 0
  }
  return OPERATION_INCOME_TYPES.has(operation.type)
}

export function getSignedOperationAmount(operation: Operation): number {
  const abs = Math.abs(operation.amount)
  return isOperationIncome(operation) ? abs : -abs
}
