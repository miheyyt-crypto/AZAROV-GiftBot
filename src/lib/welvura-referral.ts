import { ROUTES } from '@/lib/constants'
import type { UserAccount } from '@/types/account'
import type { ShopProduct } from '@/types/shop'

/** Keep in sync with server/giveaway-eligibility.mjs WELVURA_TASK_1_ID */
export const WELVURA_TASK_1_ID = 'dragonmoney-task-1'
export const WELVURA_PARTNER_ID = 'dragonmoney'
export const WELVURA_TASKS_PATH = `${ROUTES.tasks}?partner=${WELVURA_PARTNER_ID}`

export const WELVURA_REFERRAL_REQUIRED_CODE = 'NOT_WELVURA_REFERRAL'

export function hasCompletedWelvuraTask1(account: UserAccount | null | undefined): boolean {
  const completed = account?.completedTasks ?? account?.claimedTaskIds ?? []
  return Array.isArray(completed) && completed.includes(WELVURA_TASK_1_ID)
}

/** Money payout products that collect Welvura ID (200₽ / 5000₽). */
export function productRequiresWelvuraReferral(product: ShopProduct | null | undefined): boolean {
  if (!product) {
    return false
  }
  if (product.checkoutField?.type === 'welvura_id') {
    return true
  }
  return Boolean(product.checkoutFields?.some((field) => field.type === 'welvura_id'))
}
