import { applyAccountSnapshot } from '@/lib/account'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { getTelegramInitData } from '@/lib/telegram'
import { mapRemoteAccount } from '@/lib/session'
import type { UserAccount } from '@/types/account'

export type GramWithdrawalRecord = {
  id: string
  userId: number
  amountGram: number
  currency: string
  status: string
  itemName?: string | null
  createdAt?: string | null
}

export type GramWithdrawalCreateResponse = {
  success: boolean
  message?: string
  code?: string
  canWithdraw?: boolean
  minAmount?: number
  gramBalance?: number
  missing?: number
  withdrawal?: GramWithdrawalRecord
  alreadyProcessed?: boolean
  user?: UserAccount
}

export function gramWithdrawalErrorMessage(code?: string, fallback?: string): string {
  switch (code) {
    case 'BELOW_MINIMUM':
      return 'Минимальная сумма для вывода — 20 Gramm.'
    case 'INSUFFICIENT_BALANCE':
      return 'Недостаточно Gramm на балансе.'
    case 'INVALID_AMOUNT':
      return 'Укажи корректную сумму вывода.'
    default:
      return fallback || 'Не удалось создать заявку. Попробуй ещё раз.'
  }
}

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

function applyRemoteUser(user: UserAccount | undefined): void {
  if (!user) {
    return
  }
  applyAccountSnapshot(mapRemoteAccount(user))
  hydrateBalanceFromAccount()
}

export async function createGramWithdrawalRequest(input: {
  amount: number
  requestId: string
}): Promise<GramWithdrawalCreateResponse> {
  const initData = getTelegramInitData()
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  try {
    const response = await fetch(apiUrl('/api/withdrawals/gram/create'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        amount: input.amount,
        requestId: input.requestId,
      }),
    })

    const payload = (await response.json().catch(() => null)) as GramWithdrawalCreateResponse | null
    if (!payload) {
      return { success: false, code: 'BAD_RESPONSE', message: 'Пустой ответ сервера.' }
    }

    applyRemoteUser(payload.user)
    return payload
  } catch {
    return {
      success: false,
      code: 'NETWORK_ERROR',
      message: 'Не удалось создать заявку. Попробуй ещё раз.',
    }
  }
}
