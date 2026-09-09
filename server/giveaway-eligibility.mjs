import {
  KICK_CONNECT_TASK_ID,
  KICK_FOLLOW_TASK_ID,
} from './constants.mjs'

/** Canonical Welvura partner task IDs (see server/partners.mjs). */
export const WELVURA_TASK_1_ID = 'dragonmoney-task-1'
export const WELVURA_TASK_2_ID = 'dragonmoney-task-2'

/** Technical eligibility enum values. */
export const GIVEAWAY_ELIGIBILITY = {
  ALL: 'all',
  KICK: 'kick',
  WELVURA_VERIFIED: 'welvura_verified',
}

/** Legacy values written by the first eligibility release. */
const LEGACY_ELIGIBILITY_MAP = {
  category_a: GIVEAWAY_ELIGIBILITY.KICK,
  category_b: GIVEAWAY_ELIGIBILITY.WELVURA_VERIFIED,
}

/**
 * Extensible registry: add new keys without rewriting giveaway join/finalize.
 */
export const GIVEAWAY_ELIGIBILITY_CONFIG = {
  [GIVEAWAY_ELIGIBILITY.ALL]: {
    id: GIVEAWAY_ELIGIBILITY.ALL,
    adminLabel: 'Для всех',
    adminButton: '👥 Все',
    publicLabel: '👥 Для всех',
    historyLabel: 'Все',
    denyTitle: '🔒 Участие недоступно',
    denyDescription: 'Участвовать может любой пользователь.',
    denyMessage: 'Участвовать может любой пользователь.',
    actionLabel: 'К заданиям',
    navigation: { type: 'tasks' },
  },
  [GIVEAWAY_ELIGIBILITY.KICK]: {
    id: GIVEAWAY_ELIGIBILITY.KICK,
    adminLabel: 'Kick — привязка + подписка',
    adminButton: '🎮 Kick — привязка Kick + подписка на канал',
    publicLabel: '🎮 Требуется Kick',
    historyLabel: 'Kick',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Для участия нужно привязать Kick и выполнить задание подписки на канал.',
    denyMessage:
      'Чтобы участвовать, привяжите Kick и выполните задание подписки на канал.',
    actionLabel: '📋 Выполнить задания',
    navigation: { type: 'task', taskId: KICK_CONNECT_TASK_ID },
    requiredTaskIds: [KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID],
  },
  [GIVEAWAY_ELIGIBILITY.WELVURA_VERIFIED]: {
    id: GIVEAWAY_ELIGIBILITY.WELVURA_VERIFIED,
    adminLabel: 'Welvura — задания + подтверждение',
    adminButton: '🎁 Welvura — выполнены оба задания + подтверждение',
    publicLabel: '🎁 Требуется Welvura',
    historyLabel: 'Welvura',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Для участия нужно выполнить оба задания Welvura и пройти подтверждение.',
    denyMessage:
      'Чтобы участвовать, выполните оба задания Welvura и пройдите подтверждение.',
    actionLabel: '📋 Выполнить задания',
    navigation: { type: 'partner', partnerId: 'dragonmoney' },
    requiredTaskIds: [WELVURA_TASK_1_ID, WELVURA_TASK_2_ID],
    requiresWelvuraVerified: true,
  },
}

/**
 * Normalize raw eligibility for create/API.
 * Empty → all. Legacy category_* → new values. Unknown → null.
 */
export function normalizeGiveawayEligibility(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  if (!value) {
    return GIVEAWAY_ELIGIBILITY.ALL
  }
  if (Object.prototype.hasOwnProperty.call(LEGACY_ELIGIBILITY_MAP, value)) {
    return LEGACY_ELIGIBILITY_MAP[value]
  }
  if (Object.prototype.hasOwnProperty.call(GIVEAWAY_ELIGIBILITY_CONFIG, value)) {
    return value
  }
  return null
}

/**
 * Resolve eligibility for a giveaway row / raw string.
 * Missing field → all. Legacy mapped. Unknown → null (do not treat as all).
 */
export function resolveGiveawayEligibility(giveawayOrRaw) {
  if (giveawayOrRaw == null) {
    return GIVEAWAY_ELIGIBILITY.ALL
  }
  if (typeof giveawayOrRaw === 'string') {
    return normalizeGiveawayEligibility(giveawayOrRaw)
  }
  if (giveawayOrRaw.eligibility == null || giveawayOrRaw.eligibility === '') {
    return GIVEAWAY_ELIGIBILITY.ALL
  }
  return normalizeGiveawayEligibility(giveawayOrRaw.eligibility)
}

/** Public DTO: unknown corrupt values fall back to all for display only. */
export function resolvePublicGiveawayEligibility(giveawayOrRaw) {
  return resolveGiveawayEligibility(giveawayOrRaw) || GIVEAWAY_ELIGIBILITY.ALL
}

export function getEligibilityConfig(eligibility) {
  const id = resolvePublicGiveawayEligibility(eligibility)
  return GIVEAWAY_ELIGIBILITY_CONFIG[id] || GIVEAWAY_ELIGIBILITY_CONFIG[GIVEAWAY_ELIGIBILITY.ALL]
}

function userHasCompletedTask(user, taskId) {
  if (!taskId) {
    return true
  }
  const list = Array.isArray(user?.completedTasks) ? user.completedTasks : []
  return list.includes(taskId)
}

/** Server-side Welvura verification flag only — never trust the client. */
export function isUserWelvuraVerified(user) {
  return user?.welvuraVerified === true
}

/**
 * Backend eligibility gate. Never trust the client.
 * @returns {{ eligible: true, eligibility: string } | { eligible: false, eligibility: string, requirement: string, missing: string[], message: string }}
 */
export function checkGiveawayEligibility(user, giveaway) {
  const eligibility = resolveGiveawayEligibility(giveaway)

  if (eligibility == null) {
    return {
      eligible: false,
      eligibility: String(giveaway?.eligibility || ''),
      requirement: String(giveaway?.eligibility || 'unknown'),
      missing: ['unknown_eligibility'],
      message: 'Некорректное ограничение участия в розыгрыше.',
    }
  }

  if (eligibility === GIVEAWAY_ELIGIBILITY.ALL) {
    return { eligible: true, eligibility }
  }

  const config = GIVEAWAY_ELIGIBILITY_CONFIG[eligibility]
  if (!config) {
    return {
      eligible: false,
      eligibility,
      requirement: eligibility,
      missing: ['unknown_eligibility'],
      message: 'Некорректное ограничение участия в розыгрыше.',
    }
  }

  const missing = []

  if (eligibility === GIVEAWAY_ELIGIBILITY.KICK) {
    if (!userHasCompletedTask(user, KICK_CONNECT_TASK_ID)) {
      missing.push(KICK_CONNECT_TASK_ID)
    }
    if (!userHasCompletedTask(user, KICK_FOLLOW_TASK_ID)) {
      missing.push(KICK_FOLLOW_TASK_ID)
    }
  } else if (eligibility === GIVEAWAY_ELIGIBILITY.WELVURA_VERIFIED) {
    if (!userHasCompletedTask(user, WELVURA_TASK_1_ID)) {
      missing.push(WELVURA_TASK_1_ID)
    }
    if (!userHasCompletedTask(user, WELVURA_TASK_2_ID)) {
      missing.push(WELVURA_TASK_2_ID)
    }
    if (!isUserWelvuraVerified(user)) {
      missing.push('welvura_verified')
    }
  }

  if (missing.length === 0) {
    return { eligible: true, eligibility }
  }

  return {
    eligible: false,
    eligibility,
    requirement: eligibility,
    missing,
    message: config.denyMessage || config.denyDescription,
  }
}
