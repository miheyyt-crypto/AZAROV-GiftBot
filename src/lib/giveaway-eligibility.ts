import { ROUTES } from '@/lib/constants'
import type { GiveawayEligibility } from '@/types/giveaway'

export type GiveawayEligibilityUiConfig = {
  id: GiveawayEligibility
  publicLabel: string
  lockedHint: string
  denyTitle: string
  denyDescription: string
  actionLabel: string
  /** Path for «Выполнить задание» — opens Tasks with optional deep-link. */
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
  referral: {
    id: 'referral',
    publicLabel: '👤 Для рефералов',
    lockedHint: '🔒 Для рефералов',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Чтобы участвовать в этом розыгрыше, нужно выполнить первое задание Welvura.',
    actionLabel: '📋 Выполнить задание',
    actionPath: `${ROUTES.tasks}?partner=dragonmoney`,
  },
  depositor: {
    id: 'depositor',
    publicLabel: '💰 Для деперов',
    lockedHint: '🔒 Для деперов',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Чтобы участвовать в этом розыгрыше, нужно выполнить второе задание Welvura.',
    actionLabel: '📋 Выполнить задание',
    actionPath: `${ROUTES.tasks}?partner=dragonmoney`,
  },
}

/**
 * Normalize for UI. Legacy kick/category_* → safe display values.
 * Unknown → all.
 */
export function normalizeGiveawayEligibility(raw: unknown): GiveawayEligibility {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  if (!value || value === 'all' || value === 'category_a' || value === 'kick') {
    return 'all'
  }
  if (value === 'referral') {
    return 'referral'
  }
  if (
    value === 'depositor' ||
    value === 'category_b' ||
    value === 'welvura_verified'
  ) {
    return 'depositor'
  }
  return 'all'
}

export function getGiveawayEligibilityUi(eligibility: unknown): GiveawayEligibilityUiConfig {
  const id = normalizeGiveawayEligibility(eligibility)
  return GIVEAWAY_ELIGIBILITY_UI[id]
}
