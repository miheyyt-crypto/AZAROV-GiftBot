import { applyAccountSnapshot } from '@/lib/account'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { getTelegramInitData } from '@/lib/telegram'
import { mapRemoteAccount } from '@/lib/session'
import type { UserAccount } from '@/types/account'

export type WithdrawalRecord = {
  id: string
  userId: number
  itemId: string
  amountRub: number
  currency: string
  method: string
  walletAddress: string
  status: string
  itemName?: string | null
  createdAt?: string | null
}

export type WithdrawalCreateResponse = {
  success: boolean
  message?: string
  code?: string
  withdrawal?: WithdrawalRecord
  user?: UserAccount
}

/** Same TRON / TRC20 check as shop USDT field. */
export const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

export function isValidTronAddress(value: string): boolean {
  return TRON_ADDRESS_RE.test(String(value || '').trim())
}

export function withdrawalErrorMessage(code?: string, fallback?: string): string {
  switch (code) {
    case 'ALREADY_PENDING':
      return 'Для этого предмета уже создана заявка на вывод.'
    case 'ALREADY_WITHDRAWN':
      return 'Этот предмет уже выведен.'
    case 'ITEM_NOT_FOUND':
      return 'Предмет недоступен.'
    case 'NOT_WITHDRAWABLE':
      return 'Этот предмет нельзя вывести.'
    case 'INVALID_WALLET':
      return 'Проверьте адрес USDT TRC20.'
    default:
      return fallback || 'Не удалось создать заявку. Попробуйте ещё раз.'
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

export async function createWithdrawalRequest(input: {
  itemId: string
  walletAddress: string
}): Promise<WithdrawalCreateResponse> {
  const initData = getTelegramInitData()
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  try {
    const response = await fetch(apiUrl('/api/withdrawals/create'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        itemId: input.itemId,
        walletAddress: String(input.walletAddress || '').trim(),
      }),
    })

    const payload = (await response.json().catch(() => null)) as WithdrawalCreateResponse | null
    if (!payload) {
      console.error('[WITHDRAWAL]', {
        stage: 'empty_response',
        status: response.status,
        itemId: input.itemId,
      })
      return { success: false, code: 'BAD_RESPONSE', message: 'Пустой ответ сервера.' }
    }

    if (!payload.success) {
      console.error('[WITHDRAWAL]', {
        stage: 'api_error',
        status: response.status,
        code: payload.code || null,
        itemId: input.itemId,
      })
    }

    applyRemoteUser(payload.user)
    return payload
  } catch (error) {
    console.error('[WITHDRAWAL]', error)
    return {
      success: false,
      code: 'NETWORK_ERROR',
      message: 'Не удалось создать заявку. Попробуйте ещё раз.',
    }
  }
}
