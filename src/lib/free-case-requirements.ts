import type { UserAccount } from '@/types/account'

export const TELEGRAM_SUBSCRIBE_TASK_ID = 'telegram-subscribe'

export const FREE_CASE_KICK_PROFILE_PATH = '/profile?section=kick'
export const FREE_CASE_TELEGRAM_TASK_PATH = `/tasks?task=${TELEGRAM_SUBSCRIBE_TASK_ID}`

export type FreeCaseRequirements = {
  kickLinked: boolean
  telegramTaskCompleted: boolean
  cooldownExpired: boolean
  canOpen: boolean
}

export function getFreeCaseRequirements(
  account: Pick<
    UserAccount,
    | 'kickConnected'
    | 'kickUserId'
    | 'claimedTaskIds'
    | 'completedTasks'
    | 'dailyFreeCaseAvailable'
    | 'dailyFreeCaseAvailableAt'
  >,
  nowMs = Date.now(),
): FreeCaseRequirements {
  const kickLinked = Boolean(account.kickConnected || account.kickUserId)
  const tasks = account.claimedTaskIds ?? account.completedTasks ?? []
  const telegramTaskCompleted = tasks.includes(TELEGRAM_SUBSCRIBE_TASK_ID)

  let cooldownExpired =
    account.dailyFreeCaseAvailable == null ? true : Boolean(account.dailyFreeCaseAvailable)
  if (account.dailyFreeCaseAvailableAt) {
    const end = Date.parse(account.dailyFreeCaseAvailableAt)
    if (Number.isFinite(end)) {
      cooldownExpired = nowMs >= end
    }
  }

  return {
    kickLinked,
    telegramTaskCompleted,
    cooldownExpired,
    canOpen: kickLinked && telegramTaskCompleted && cooldownExpired,
  }
}
