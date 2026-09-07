import { applyAccountSnapshot, getCurrentAccount } from '@/lib/account'
import { claimInviteFriendsTask, checkTelegramSubscribe } from '@/lib/api'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import {
  REFERRAL_INVITE_TASK_ID,
  REFERRAL_INVITE_TASK_REQUIRED,
} from '@/lib/constants'
import { getTasks } from '@/data/tasks'
import { mapRemoteAccount } from '@/lib/session'
import { createPurchaseRequestId } from '@/lib/shop'
import type { FilterCategory, Task } from '@/types'

export function filterTasks(tasks: Task[], category: FilterCategory): Task[] {
  if (category === 'partners' || category === 'all') {
    return tasks
  }

  return tasks.filter((task) => task.category === category)
}

export function shouldShowPartners(): boolean {
  return true
}

export function shouldShowRegularTasks(category: FilterCategory): boolean {
  return category !== 'partners'
}

export function getVisibleTasks(): Task[] {
  const account = getCurrentAccount()

  return getTasks().map((task) => {
    if (task.type === 'referral') {
      const current = account.activeReferrals
      const claimed = account.claimedTaskIds.includes(task.id)
      const completed = claimed || current >= REFERRAL_INVITE_TASK_REQUIRED

      return {
        ...task,
        status: completed ? 'completed' : 'in_progress',
        completed,
        rewardClaimed: claimed,
        progress: {
          current,
          required: REFERRAL_INVITE_TASK_REQUIRED,
          label: task.progress?.label ?? 'Прогресс',
        },
      }
    }

    if (account.claimedTaskIds.includes(task.id)) {
      return {
        ...task,
        status: 'completed',
        completed: true,
        rewardClaimed: true,
      }
    }

    return task
  })
}

function applyRemoteUser(user: Parameters<typeof mapRemoteAccount>[0] | undefined): void {
  if (!user) {
    return
  }

  applyAccountSnapshot(mapRemoteAccount(user))
  hydrateBalanceFromAccount()
}

export async function handleTaskAction(
  taskId: string,
): Promise<{ success: boolean; message?: string; code?: string; alreadyCompleted?: boolean }> {
  if (taskId === 'telegram-subscribe') {
    try {
      const result = await checkTelegramSubscribe(createPurchaseRequestId())
      applyRemoteUser(result.user)

      if (result.alreadyCompleted || (result.success && result.completed)) {
        return {
          success: true,
          alreadyCompleted: Boolean(result.alreadyCompleted),
          code: result.code,
          message:
            result.message ||
            (result.alreadyCompleted
              ? 'Задание уже выполнено.'
              : 'Подписка подтверждена. Награда начислена.'),
        }
      }

      return {
        success: false,
        code: result.code,
        message: result.message || 'Сначала подпишись на канал @azarov222.',
      }
    } catch {
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: 'Не удалось проверить подписку. Попробуй ещё раз позже.',
      }
    }
  }

  if (taskId === REFERRAL_INVITE_TASK_ID) {
    try {
      const result = await claimInviteFriendsTask(createPurchaseRequestId())
      applyRemoteUser(result.user)
      return {
        success: Boolean(result.success),
        message: result.message,
      }
    } catch {
      return {
        success: false,
        message: `Приглашено активных друзей: ${getCurrentAccount().activeReferrals} из ${REFERRAL_INVITE_TASK_REQUIRED}.`,
      }
    }
  }

  return {
    success: false,
    message: `Действие для задания «${taskId}» будет доступно после подключения backend.`,
  }
}

export function handlePartnerAction(partnerId: string): string {
  return partnerId
}
