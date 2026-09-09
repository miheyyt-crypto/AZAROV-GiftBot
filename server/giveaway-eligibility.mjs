/** Canonical Welvura partner task IDs (see server/partners.mjs). */
export const WELVURA_TASK_1_ID = 'dragonmoney-task-1'
export const WELVURA_TASK_2_ID = 'dragonmoney-task-2'

/** Technical eligibility enum values (new giveaways only). */
export const GIVEAWAY_ELIGIBILITY = {
  ALL: 'all',
  REFERRAL: 'referral',
  DEPOSITOR: 'depositor',
}

/**
 * Legacy storage values → canonical eligibility for safe read/check.
 * Kick must never gate participation; old kick-based rows open as `all`.
 * Old Welvura-gated rows map to `depositor` (task-2 completed).
 */
const LEGACY_ELIGIBILITY_MAP = {
  category_a: GIVEAWAY_ELIGIBILITY.ALL,
  category_b: GIVEAWAY_ELIGIBILITY.DEPOSITOR,
  kick: GIVEAWAY_ELIGIBILITY.ALL,
  welvura_verified: GIVEAWAY_ELIGIBILITY.DEPOSITOR,
}

/**
 * Extensible registry: add new keys without rewriting giveaway join/finalize.
 */
export const GIVEAWAY_ELIGIBILITY_CONFIG = {
  [GIVEAWAY_ELIGIBILITY.ALL]: {
    id: GIVEAWAY_ELIGIBILITY.ALL,
    adminLabel: 'Для всех',
    adminButton: '👥 Для всех',
    publicLabel: '👥 Для всех',
    historyLabel: 'Все',
    adminDescription: 'Участвовать может любой пользователь.',
    denyTitle: '🔒 Участие недоступно',
    denyDescription: 'Участвовать может любой пользователь.',
    denyMessage: 'Участвовать может любой пользователь.',
    actionLabel: 'К заданиям',
    navigation: { type: 'tasks' },
    requiredTaskId: null,
  },
  [GIVEAWAY_ELIGIBILITY.REFERRAL]: {
    id: GIVEAWAY_ELIGIBILITY.REFERRAL,
    adminLabel: 'Для рефералов',
    adminButton: '👤 Для рефералов',
    publicLabel: '👤 Для рефералов',
    historyLabel: 'Рефералы',
    adminDescription: 'Для пользователей, выполнивших первое задание Welvura.',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Чтобы участвовать в этом розыгрыше, нужно выполнить первое задание Welvura.',
    denyMessage:
      'Чтобы участвовать в этом розыгрыше, нужно выполнить первое задание Welvura.',
    actionLabel: '📋 Выполнить задание',
    navigation: { type: 'partner', partnerId: 'dragonmoney' },
    requiredTaskId: WELVURA_TASK_1_ID,
  },
  [GIVEAWAY_ELIGIBILITY.DEPOSITOR]: {
    id: GIVEAWAY_ELIGIBILITY.DEPOSITOR,
    adminLabel: 'Для деперов',
    adminButton: '💰 Для деперов',
    publicLabel: '💰 Для деперов',
    historyLabel: 'Деперы',
    adminDescription: 'Для пользователей, выполнивших второе задание Welvura.',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Чтобы участвовать в этом розыгрыше, нужно выполнить второе задание Welvura.',
    denyMessage:
      'Чтобы участвовать в этом розыгрыше, нужно выполнить второе задание Welvura.',
    actionLabel: '📋 Выполнить задание',
    navigation: { type: 'partner', partnerId: 'dragonmoney' },
    requiredTaskId: WELVURA_TASK_2_ID,
  },
}

/**
 * Normalize for create/API write. Only canonical values.
 * Empty → all. Legacy/unknown → null (reject on create).
 */
export function normalizeGiveawayEligibility(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  if (!value) {
    return GIVEAWAY_ELIGIBILITY.ALL
  }
  if (Object.prototype.hasOwnProperty.call(GIVEAWAY_ELIGIBILITY_CONFIG, value)) {
    return value
  }
  return null
}

/**
 * Resolve eligibility for a giveaway row / raw string (read path).
 * Missing → all. Legacy mapped. Unknown → null (do not treat as all for join).
 */
export function resolveGiveawayEligibility(giveawayOrRaw) {
  if (giveawayOrRaw == null) {
    return GIVEAWAY_ELIGIBILITY.ALL
  }

  let raw
  if (typeof giveawayOrRaw === 'string') {
    raw = giveawayOrRaw
  } else if (giveawayOrRaw.eligibility == null || giveawayOrRaw.eligibility === '') {
    return GIVEAWAY_ELIGIBILITY.ALL
  } else {
    raw = giveawayOrRaw.eligibility
  }

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

/**
 * Backend eligibility gate. Never trust the client.
 * Uses completedTasks (set only after server-side partner task approval).
 * Kick tasks / welvuraVerified are intentionally ignored.
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

  const requiredTaskId = config.requiredTaskId
  if (!requiredTaskId || userHasCompletedTask(user, requiredTaskId)) {
    return { eligible: true, eligibility }
  }

  return {
    eligible: false,
    eligibility,
    requirement: eligibility,
    missing: [requiredTaskId],
    message: config.denyMessage || config.denyDescription,
  }
}
