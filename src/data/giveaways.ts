import type { Giveaway } from '@/types/giveaway'

/**
 * Dev-only mock catalog when GET /api/giveaways is unavailable.
 * Keep empty so completed/active tabs match production empty state.
 */
export const MOCK_GIVEAWAYS: Giveaway[] = []

export function filterGiveawaysByStatus(
  items: Giveaway[],
  status: Giveaway['status'],
): Giveaway[] {
  return items.filter((item) => item.status === status)
}
