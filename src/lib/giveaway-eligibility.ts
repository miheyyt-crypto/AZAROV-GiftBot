import { ROUTES } from '@/lib/constants'
import type { GiveawayEligibility } from '@/types/giveaway'

export type GiveawayEligibilityUiConfig = {
  id: GiveawayEligibility
  publicLabel: string
  lockedHint: string
  denyTitle: string
  denyDescription: string
  actionLabel: string
  /** Path for «Выполнить задания» — opens Tasks with optional deep-link. */
  actionPath: string
}

/**
 * Frontend copy + navigation for eligibility categories.
 * Keep technical ids in sync with server/giveaway-eligibility.mjs.
 */
export const GIVEAWAY_ELIGIBILITY_UI: Record<GiveawayEligibility, GiveawayEligibilityUiConfig> = {
  all: {
    id: 'all',
    publicLabel: '👥 Для всех',
    lockedHint: '',
    denyTitle: '🔒 Участие недоступно',
    denyDescription: 'Участвовать может любой пользователь.',
    actionLabel: 'К заданиям',
    actionPath: ROUTES.tasks,
  },
  kick: {
    id: 'kick',
    publicLabel: '🎮 Требуется Kick',
    lockedHint: '🔒 Требуется Kick',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Для участия нужно привязать Kick и выполнить задание подписки на канал.',
    actionLabel: '📋 Выполнить задания',
    actionPath: `${ROUTES.tasks}?task=kick-connect`,
  },
  welvura_verified: {
    id: 'welvura_verified',
    publicLabel: '🎁 Требуется Welvura',
    lockedHint: '🔒 Требуется Welvura',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Для участия нужно выполнить оба задания Welvura и пройти подтверждение.',
    actionLabel: '📋 Выполнить задания',
    actionPath: `${ROUTES.tasks}?partner=dragonmoney`,
  },
}

/** Legacy category_* → new values. Unknown → all for safe UI display. */
export function normalizeGiveawayEligibility(raw: unknown): GiveawayEligibility {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  if (!value || value === 'all') {
    return 'all'
  }
  if (value === 'category_a' || value === 'kick') {
    return 'kick'
  }
  if (value === 'category_b' || value === 'welvura_verified') {
    return 'welvura_verified'
  }
  return 'all'
}

export function getGiveawayEligibilityUi(eligibility: unknown): GiveawayEligibilityUiConfig {
  const id = normalizeGiveawayEligibility(eligibility)
  return GIVEAWAY_ELIGIBILITY_UI[id]
}
