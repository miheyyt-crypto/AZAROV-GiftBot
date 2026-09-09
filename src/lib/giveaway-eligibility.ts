import { ROUTES } from '@/lib/constants'
import type { GiveawayEligibility } from '@/types/giveaway'

export type GiveawayEligibilityUiConfig = {
  id: GiveawayEligibility
  publicLabel: string
  lockedHint: string
  denyTitle: string
  denyDescription: string
  actionLabel: string
  /** Path for «Выполнить задание» — opens Tasks with optional task deep-link. */
  actionPath: string
}

/**
 * Frontend copy + navigation for eligibility categories.
 * Keep technical ids in sync with server/giveaway-eligibility.mjs.
 */
export const GIVEAWAY_ELIGIBILITY_UI: Record<GiveawayEligibility, GiveawayEligibilityUiConfig> = {
  all: {
    id: 'all',
    publicLabel: '👤 Участвовать могут все',
    lockedHint: '',
    denyTitle: 'Участие недоступно',
    denyDescription: 'Этот розыгрыш недоступен для участия.',
    actionLabel: 'К заданиям',
    actionPath: ROUTES.tasks,
  },
  category_a: {
    id: 'category_a',
    publicLabel: '👥 Только после привязки Kick',
    lockedHint: '🔒 Только после привязки Kick',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Чтобы участвовать в этом розыгрыше, необходимо сначала выполнить задание «Привяжи Kick».',
    actionLabel: '📋 Выполнить задание',
    actionPath: `${ROUTES.tasks}?task=kick-connect`,
  },
  category_b: {
    id: 'category_b',
    publicLabel: '⭐ Только после подписки на Kick',
    lockedHint: '🔒 Только после подписки на Kick',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Чтобы участвовать в этом розыгрыше, необходимо сначала выполнить задание «Зафолловься на канал Kick».',
    actionLabel: '📋 Выполнить задание',
    actionPath: `${ROUTES.tasks}?task=kick-follow`,
  },
}

export function normalizeGiveawayEligibility(
  raw: unknown,
): GiveawayEligibility {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  if (value === 'category_a' || value === 'category_b' || value === 'all') {
    return value
  }
  return 'all'
}

export function getGiveawayEligibilityUi(
  eligibility: unknown,
): GiveawayEligibilityUiConfig {
  const id = normalizeGiveawayEligibility(eligibility)
  return GIVEAWAY_ELIGIBILITY_UI[id]
}
