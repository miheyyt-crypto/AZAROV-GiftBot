import caseMedium from '@/assets/cases/medium.webp'
import casePoor from '@/assets/cases/poor.webp'
import caseReferral from '@/assets/cases/referral.webp'
import caseRich from '@/assets/cases/rich.webp'
import type { Giveaway } from '@/types/giveaway'

/**
 * Temporary mock catalog until GET /api/giveaways is available.
 * Keep active list empty so Home empty-state matches the product intent.
 */
export const MOCK_GIVEAWAYS: Giveaway[] = [
  {
    id: 'gw-completed-1',
    title: 'БОНУСКА ЗА 64 РУБЛЯ',
    image: casePoor,
    status: 'completed',
    winnersCount: 1,
    createdAt: '2026-08-20T12:00:00.000Z',
    endedAt: '2026-08-22T18:00:00.000Z',
  },
  {
    id: 'gw-completed-2',
    title: '🍪 ДО 600.000р НА КЕЙСАХ',
    image: caseMedium,
    status: 'completed',
    winnersCount: 10,
    createdAt: '2026-08-10T12:00:00.000Z',
    endedAt: '2026-08-15T20:00:00.000Z',
  },
  {
    id: 'gw-completed-3',
    title: 'VIP РОЗЫГРЫШ НЕДЕЛИ',
    image: caseRich,
    status: 'completed',
    winnersCount: 3,
    createdAt: '2026-07-28T12:00:00.000Z',
    endedAt: '2026-08-01T21:00:00.000Z',
  },
  {
    id: 'gw-completed-4',
    title: 'РЕФЕРАЛЬНЫЙ СУПЕРПРИЗ',
    image: caseReferral,
    status: 'completed',
    winnersCount: 5,
    createdAt: '2026-07-01T12:00:00.000Z',
    endedAt: '2026-07-07T19:00:00.000Z',
  },
]

export function filterGiveawaysByStatus(
  items: Giveaway[],
  status: Giveaway['status'],
): Giveaway[] {
  return items.filter((item) => item.status === status)
}
