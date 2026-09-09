import {
  KICK_CONNECT_TASK_ID,
  KICK_FOLLOW_TASK_ID,
} from './constants.mjs'

/** Technical eligibility enum values. */
export const GIVEAWAY_ELIGIBILITY = {
  ALL: 'all',
  CATEGORY_A: 'category_a',
  CATEGORY_B: 'category_b',
}

/**
 * Extensible registry: add new keys without rewriting giveaway join/finalize.
 * `taskId` must match an entry in user.completedTasks when that requirement is done.
 */
export const GIVEAWAY_ELIGIBILITY_CONFIG = {
  [GIVEAWAY_ELIGIBILITY.ALL]: {
    id: GIVEAWAY_ELIGIBILITY.ALL,
    taskId: null,
    adminLabel: 'Для всех',
    adminButton: '👤 Для всех',
    publicLabel: '👤 Участвовать могут все',
    historyLabel: 'Все',
    denyTitle: 'Участие недоступно',
    denyDescription: 'Этот розыгрыш недоступен для участия.',
    actionLabel: 'К заданиям',
    navigation: { type: 'tasks' },
  },
  [GIVEAWAY_ELIGIBILITY.CATEGORY_A]: {
    id: GIVEAWAY_ELIGIBILITY.CATEGORY_A,
    taskId: KICK_CONNECT_TASK_ID,
    adminLabel: 'Категория A — Привяжи Kick',
    adminButton: '👥 Категория A (Kick)',
    publicLabel: '👥 Только после привязки Kick',
    historyLabel: 'Категория A',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Этот розыгрыш доступен только после привязки аккаунта Kick. Выполните задание «Привяжи Kick», затем нажмите «Участвовать» снова.',
    actionLabel: '📋 Выполнить задание',
    navigation: { type: 'task', taskId: KICK_CONNECT_TASK_ID },
  },
  [GIVEAWAY_ELIGIBILITY.CATEGORY_B]: {
    id: GIVEAWAY_ELIGIBILITY.CATEGORY_B,
    taskId: KICK_FOLLOW_TASK_ID,
    adminLabel: 'Категория B — Подписка Kick',
    adminButton: '⭐ Категория B (Kick follow)',
    publicLabel: '⭐ Только после подписки на Kick',
    historyLabel: 'Категория B',
    denyTitle: '🔒 Участие недоступно',
    denyDescription:
      'Этот розыгрыш доступен только после подписки на канал Kick. Выполните задание «Зафолловься на канал Kick», затем нажмите «Участвовать» снова.',
    actionLabel: '📋 Выполнить задание',
    navigation: { type: 'task', taskId: KICK_FOLLOW_TASK_ID },
  },
}

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

/** Legacy / missing field → all. */
export function resolveGiveawayEligibility(giveawayOrRaw) {
  if (giveawayOrRaw == null) {
    return GIVEAWAY_ELIGIBILITY.ALL
  }
  if (typeof giveawayOrRaw === 'string') {
    return normalizeGiveawayEligibility(giveawayOrRaw) || GIVEAWAY_ELIGIBILITY.ALL
  }
  if (giveawayOrRaw.eligibility == null || giveawayOrRaw.eligibility === '') {
    return GIVEAWAY_ELIGIBILITY.ALL
  }
  return normalizeGiveawayEligibility(giveawayOrRaw.eligibility) || GIVEAWAY_ELIGIBILITY.ALL
}

export function getEligibilityConfig(eligibility) {
  const id = resolveGiveawayEligibility(eligibility)
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
 * @returns {{ eligible: true, eligibility: string } | { eligible: false, eligibility: string, requirement: string, taskId: string|null, message: string }}
 */
export function checkGiveawayEligibility(user, giveaway) {
  const eligibility = resolveGiveawayEligibility(giveaway)
  const config = getEligibilityConfig(eligibility)

  if (eligibility === GIVEAWAY_ELIGIBILITY.ALL || !config.taskId) {
    return { eligible: true, eligibility }
  }

  if (userHasCompletedTask(user, config.taskId)) {
    return { eligible: true, eligibility }
  }

  return {
    eligible: false,
    eligibility,
    requirement: eligibility,
    taskId: config.taskId,
    message: config.denyDescription,
  }
}
