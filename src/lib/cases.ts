import { applyAccountSnapshot } from '@/lib/account'
import { openCaseRequest } from '@/lib/api'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import {
  getAvailableReferralCases as getAvailableReferralCasesFromAccount,
  getReferralCaseStats,
} from '@/lib/referral'
import { mapRemoteAccount } from '@/lib/session'
import { createPurchaseRequestId } from '@/lib/shop'
import type { UserAccount } from '@/types/account'
import type { CaseOpening } from '@/types/case'

const pendingByRequestId = new Map<
  string,
  Promise<{ success: boolean; message?: string; code?: string; opening?: CaseOpening }>
>()

function applyRemoteUser(user: Parameters<typeof mapRemoteAccount>[0] | undefined): void {
  if (!user) {
    return
  }

  applyAccountSnapshot(mapRemoteAccount(user))
  hydrateBalanceFromAccount()
}

export function getReferralCaseStatsForAccount(account: UserAccount) {
  return getReferralCaseStats(account)
}

export function getAvailableReferralCases(account: UserAccount): number {
  return getAvailableReferralCasesFromAccount(account)
}

export async function openCase(
  caseId: string,
  requestId = createPurchaseRequestId(),
): Promise<{ success: boolean; message?: string; code?: string; opening?: CaseOpening }> {
  const pending = pendingByRequestId.get(requestId)
  if (pending) {
    return pending
  }

  const request = (async () => {
    try {
      const result = await openCaseRequest(caseId, requestId)
      console.info('[case-open-client] mapped:', {
        success: result.success,
        code: result.code,
        message: result.message,
        hasOpening: Boolean(result.opening),
        openingKeys: result.opening ? Object.keys(result.opening) : [],
        hasUser: Boolean(result.user),
        prize: result.opening?.prize
          ? {
              id: result.opening.prize.id,
              name: result.opening.prize.name,
              amount: result.opening.prize.amount,
              currency: result.opening.prize.currency,
              rarity: result.opening.prize.rarity,
            }
          : null,
      })
      applyRemoteUser(result.user)
      return {
        success: Boolean(result.success),
        message: result.message,
        code: result.code,
        opening: result.opening,
      }
    } catch (error) {
      console.info('[case-open-client] fetch/parse failed:', {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : 'unknown',
      })
      return {
        success: false,
        message: 'Не удалось открыть кейс. Попробуй ещё раз.',
      }
    }
  })()

  pendingByRequestId.set(requestId, request)

  try {
    return await request
  } finally {
    pendingByRequestId.delete(requestId)
  }
}

export async function openReferralCase(
  caseId = 'referral',
  requestId = createPurchaseRequestId(),
): Promise<{ success: boolean; message?: string; opening?: CaseOpening }> {
  return openCase(caseId, requestId)
}
