import { applyAccountSnapshot, getCurrentAccount } from '@/lib/account'
import { claimInviteFriendsTask, checkKickFollow, checkKickNickname, checkTelegramSubscribe } from '@/lib/api'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import {
  REFERRAL_INVITE_TASK_ID,
  REFERRAL_INVITE_TASK_REQUIRED,
} from '@/lib/constants'
import { getTasks } from '@/data/tasks'
import {
  getKickConnection,
  initiateKickOAuth,
  refreshKickAccountState,
} from '@/lib/kick'
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

function isKickLinked(account = getCurrentAccount()): boolean {
  return Boolean(
    account.kickConnected ||
      account.kickUserId ||
      getKickConnection().connected ||
      getKickConnection().userId,
  )
}

export function getVisibleTasks(): Task[] {
  const account = getCurrentAccount()
  const kickLinked = isKickLinked(account)

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

    if (task.type === 'kick_connect') {
      const claimed = account.claimedTaskIds.includes(task.id)
      const completed = claimed || kickLinked
      return {
        ...task,
        status: completed ? 'completed' : 'available',
        completed,
        rewardClaimed: claimed,
      }
    }

    // Follow/nickname require a linked Kick account — connection ≠ follow check.
    if ((task.type === 'kick_follow' || task.type === 'kick_nickname') && !kickLinked) {
      if (account.claimedTaskIds.includes(task.id)) {
        return {
          ...task,
          status: 'completed',
          completed: true,
          rewardClaimed: true,
        }
      }
      return {
        ...task,
        status: 'locked',
        completed: false,
        rewardClaimed: false,
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

  if (taskId === 'kick-connect') {
    await refreshKickAccountState()
    if (isKickLinked()) {
      return {
        success: true,
        alreadyCompleted: true,
        code: 'ALREADY_CONNECTED',
        message: 'Kick уже подключён.',
      }
    }

    const started = await initiateKickOAuth()
    if (started.code === 'already_connected') {
      await refreshKickAccountState()
      return {
        success: true,
        alreadyCompleted: true,
        code: 'ALREADY_CONNECTED',
        message: started.message || 'Kick уже подключён.',
      }
    }

    return {
      success: Boolean(started.success),
      code: started.code,
      message:
        started.message ||
        (started.success
          ? 'Открой Kick и подтверди привязку. После возврата статус обновится автоматически.'
          : 'Не удалось начать привязку Kick.'),
    }
  }

  if (taskId === 'kick-follow') {
    try {
      // Always refresh link status first — Mini App may still hold a stale snapshot
      // after OAuth completed in an external browser.
      await refreshKickAccountState()

      if (!isKickLinked()) {
        return {
          success: false,
          code: 'KICK_NOT_CONNECTED',
          message: 'Сначала привяжи Kick в профиле, затем проверь фоллоу на azarov7777.',
        }
      }

      const result = await checkKickFollow(createPurchaseRequestId())
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
              : 'Фоллоу подтверждён. Награда начислена.'),
        }
      }

      return {
        success: false,
        code: result.code,
        message: result.message || 'Сначала зафолловь канал kick.com/azarov7777.',
      }
    } catch {
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: 'Не удалось проверить фоллоу. Попробуй ещё раз позже.',
      }
    }
  }

  if (taskId === 'kick-nickname') {
    try {
      await refreshKickAccountState()

      if (!isKickLinked()) {
        return {
          success: false,
          code: 'KICK_NOT_CONNECTED',
          message: 'Сначала привяжи Kick в профиле, затем добавь приписку к нику.',
        }
      }

      const result = await checkKickNickname(createPurchaseRequestId())
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
              : 'Приписка подтверждена. Награда начислена.'),
        }
      }

      return {
        success: false,
        code: result.code,
        message: result.message || 'Приписка AZAROV в нике Kick не найдена.',
      }
    } catch {
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: 'Не удалось проверить ник Kick. Попробуй ещё раз позже.',
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
    code: 'UNKNOWN_TASK',
    message: 'Неизвестное задание.',
  }
}

export function handlePartnerAction(partnerId: string): string {
  return partnerId
}
