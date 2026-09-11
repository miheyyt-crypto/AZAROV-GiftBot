import { applyAccountSnapshot } from '@/lib/account'
import {
  createPartnerSubmissionRequest,
  getMyPartnerSubmissions,
  startPartnerTask,
} from '@/lib/api'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { mapRemoteAccount } from '@/lib/session'
import { createPurchaseRequestId } from '@/lib/shop'
import { getTelegramWebApp } from '@/lib/telegram'
import type {
  PartnerSubmission,
  PartnerTaskConfig,
  PartnerTaskStatus,
} from '@/types/partner'

export function resolvePartnerTaskStatus(
  taskIndex: number,
  taskId: string,
  completedIds: string[],
  startedIds: string[],
  previousTaskId: string | undefined,
  latestSubmission?: PartnerSubmission | null,
): PartnerTaskStatus {
  if (completedIds.includes(taskId) || latestSubmission?.status === 'approved') {
    return 'COMPLETED'
  }

  const previousCompleted =
    taskIndex === 0 || Boolean(previousTaskId && completedIds.includes(previousTaskId))

  if (!previousCompleted) {
    return 'LOCKED'
  }

  if (latestSubmission?.status === 'pending') {
    return 'PENDING'
  }

  if (latestSubmission?.status === 'rejected') {
    return 'REJECTED'
  }

  if (startedIds.includes(taskId)) {
    return 'IN_PROGRESS'
  }

  return 'AVAILABLE'
}

export function openPartnerUrl(url: string): void {
  const webApp = getTelegramWebApp()

  if (webApp?.openLink) {
    webApp.openLink(url)
    return
  }

  if (webApp?.openTelegramLink && url.startsWith('https://t.me/')) {
    webApp.openTelegramLink(url)
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

function applyRemoteUser(user: Parameters<typeof mapRemoteAccount>[0] | undefined): void {
  if (!user) {
    return
  }

  applyAccountSnapshot(mapRemoteAccount(user))
  hydrateBalanceFromAccount()
}

export async function startPartnerTaskAction(
  task: PartnerTaskConfig,
): Promise<{ success: boolean; message?: string }> {
  try {
    const result = await startPartnerTask(task.id)
    applyRemoteUser(result.user)

    if (result.success) {
      openPartnerUrl(task.actionUrl)
    }

    return {
      success: Boolean(result.success),
      message: result.message,
    }
  } catch {
    return {
      success: false,
      message: 'Не удалось открыть задание. Попробуй ещё раз.',
    }
  }
}

export async function submitPartnerTaskAction(input: {
  taskId: string
  partnerAccountId: string
  screenshot: File
  requestId?: string
}): Promise<{ success: boolean; message?: string; submission?: PartnerSubmission }> {
  const requestId = input.requestId || createPurchaseRequestId()

  try {
    const result = await createPartnerSubmissionRequest({
      taskId: input.taskId,
      partnerAccountId: input.partnerAccountId,
      requestId,
      screenshot: input.screenshot,
    })
    applyRemoteUser(result.user)
    return {
      success: Boolean(result.success),
      message: result.message,
      submission: result.submission,
    }
  } catch {
    return {
      success: false,
      message: 'Не удалось отправить заявку. Попробуй ещё раз.',
    }
  }
}

function indexLatestSubmissionsByTask(
  submissions: PartnerSubmission[],
): Record<string, PartnerSubmission> {
  const map: Record<string, PartnerSubmission> = {}
  for (const submission of submissions) {
    const current = map[submission.taskId]
    if (
      !current ||
      new Date(submission.createdAt).getTime() > new Date(current.createdAt).getTime()
    ) {
      map[submission.taskId] = submission
    }
  }
  return map
}

export async function loadMyPartnerSubmissions(): Promise<
  Record<string, PartnerSubmission>
> {
  try {
    const result = await getMyPartnerSubmissions()
    applyRemoteUser(result.user)
    return indexLatestSubmissionsByTask(result.submissions ?? [])
  } catch {
    return {}
  }
}

/**
 * Same source as PartnerTaskModal, but distinguishes API failure from empty list.
 * Used by entry promo so we never show the popup on unknown status.
 */
export async function loadMyPartnerSubmissionsResult(): Promise<
  | { ok: true; byTaskId: Record<string, PartnerSubmission> }
  | { ok: false }
> {
  try {
    const result = await getMyPartnerSubmissions()
    applyRemoteUser(result.user)
    if (!result.success) {
      return { ok: false }
    }
    return {
      ok: true,
      byTaskId: indexLatestSubmissionsByTask(result.submissions ?? []),
    }
  } catch {
    return { ok: false }
  }
}

export function getPartnerProgress(
  partnerId: string,
  completedIds: string[],
  totalTasks: number,
): { completed: number; total: number } {
  const prefix = `${partnerId}-task-`
  const completed = completedIds.filter((id) => id.startsWith(prefix)).length
  return {
    completed: Math.min(completed, totalTasks),
    total: totalTasks,
  }
}
