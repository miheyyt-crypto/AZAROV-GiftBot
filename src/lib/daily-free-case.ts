import { applyAccountSnapshot } from '@/lib/account'
import { openDailyFreeCaseRequest, getDailyFreeCaseStatusRequest } from '@/lib/api'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { mapRemoteAccount } from '@/lib/session'
import { createPurchaseRequestId } from '@/lib/shop'
import type { DailyFreeCaseReward } from '@/data/daily-free-case'

export interface DailyFreeCaseOpenResult {
  success: boolean
  message?: string
  code?: string
  reward?: DailyFreeCaseReward
  availableAt?: string | null
  alreadyProcessed?: boolean
}

const pendingByRequestId = new Map<string, Promise<DailyFreeCaseOpenResult>>()

function applyUser(user: Parameters<typeof mapRemoteAccount>[0] | undefined) {
  if (!user) {
    return
  }
  applyAccountSnapshot(mapRemoteAccount(user))
  hydrateBalanceFromAccount()
}

export async function fetchDailyFreeCaseStatus(): Promise<{
  available: boolean
  availableAt: string | null
}> {
  try {
    const result = await getDailyFreeCaseStatusRequest()
    applyUser(result.user)
    return {
      available: Boolean(result.available ?? result.user?.dailyFreeCaseAvailable),
      availableAt: (result.availableAt ?? result.user?.dailyFreeCaseAvailableAt ?? null) as
        | string
        | null,
    }
  } catch {
    return { available: false, availableAt: null }
  }
}

export async function openDailyFreeCase(
  requestId = createPurchaseRequestId(),
): Promise<DailyFreeCaseOpenResult> {
  const existing = pendingByRequestId.get(requestId)
  if (existing) {
    return existing
  }

  const promise = (async (): Promise<DailyFreeCaseOpenResult> => {
    try {
      const result = await openDailyFreeCaseRequest(requestId)
      applyUser(result.user)

      if (!result.success) {
        return {
          success: false,
          message: result.message,
          code: result.code,
          availableAt: (result.availableAt as string | null | undefined) ?? null,
        }
      }

      const raw = (result as { reward?: { id: string; name: string; amount: number; emoji?: string } })
        .reward
      if (!raw || !Number.isFinite(Number(raw.amount))) {
        return {
          success: false,
          message: 'Некорректный ответ сервера.',
          code: 'BAD_REWARD',
        }
      }

      return {
        success: true,
        alreadyProcessed: Boolean(result.alreadyProcessed),
        availableAt: (result.availableAt as string | null | undefined) ?? null,
        reward: {
          id: String(raw.id),
          name: String(raw.name),
          amount: Math.floor(Number(raw.amount)),
          weight: 0,
          emoji: raw.emoji || '⭐',
        },
      }
    } catch {
      return {
        success: false,
        message: 'Не удалось открыть бесплатный кейс. Попробуй ещё раз.',
        code: 'NETWORK',
      }
    } finally {
      pendingByRequestId.delete(requestId)
    }
  })()

  pendingByRequestId.set(requestId, promise)
  return promise
}
