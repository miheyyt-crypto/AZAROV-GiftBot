import { findPartnerTask } from './partners.mjs'
import { withStore } from './store.mjs'

function getStartedTasks(user) {
  return user.startedPartnerTasks || []
}

/**
 * Marks a partner task as started (user opened partner site).
 * Does NOT grant rewards — rewards only after admin approve of a submission.
 */
export function startPartnerTask(userId, taskId) {
  return withStore((store) => {
    const user = store.users[String(userId)]
    const found = findPartnerTask(taskId)

    if (!user) {
      return { success: false, message: 'Пользователь не найден.' }
    }

    if (!found) {
      return { success: false, message: 'Задание партнёра не найдено.' }
    }

    if ((user.completedTasks || []).includes(taskId)) {
      return { success: false, message: 'Задание уже выполнено.' }
    }

    if (found.previousTask && !(user.completedTasks || []).includes(found.previousTask.id)) {
      return {
        success: false,
        message: 'Сначала выполни предыдущее задание.',
      }
    }

    user.startedPartnerTasks = [...new Set([...getStartedTasks(user), taskId])]

    return {
      success: true,
      message: 'Открой сайт партнёра, затем отправь ID и скриншот на проверку.',
    }
  })
}

/**
 * Legacy auto-verify endpoint disabled — use partner submissions + admin approve.
 */
export function verifyPartnerTask() {
  return {
    success: false,
    code: 'MANUAL_REVIEW_REQUIRED',
    message: 'Автопроверка отключена. Отправь ID и скриншот на ручную проверку.',
  }
}
