import { delay } from '@/lib/format'
import { MOCK_OPERATIONS } from '@/mockData/operations'
import {
  OPERATION_PURCHASE_TYPES,
  OPERATION_REWARD_TYPES,
  isOperationIncome,
  type Operation,
  type OperationFilter,
} from '@/types/operation'

/**
 * Operations API layer.
 * Currently returns mock data. Replace body with real fetch when backend is ready.
 */
export async function getOperations(filter: OperationFilter = 'all'): Promise<Operation[]> {
  await delay(450)

  const sorted = [...MOCK_OPERATIONS].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  if (filter === 'all') {
    return sorted
  }

  if (filter === 'income') {
    return sorted.filter((item) => isOperationIncome(item))
  }

  if (filter === 'purchases') {
    return sorted.filter((item) => OPERATION_PURCHASE_TYPES.has(item.type))
  }

  return sorted.filter((item) => OPERATION_REWARD_TYPES.has(item.type))
}
