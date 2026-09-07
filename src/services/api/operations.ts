import { getTelegramInitData } from '@/lib/telegram'
import {
  iconForOperationType,
  type Operation,
  type OperationFilter,
} from '@/types/operation'
import type { CoinTransaction } from '@/types/profile'

interface CoinHistoryApiResponse {
  success?: boolean
  message?: string
  transactions?: CoinTransaction[]
}

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

function mapTransaction(item: CoinTransaction): Operation {
  const amount = Number(item.amount) || 0
  const description = String(item.description || item.label || item.type || 'Операция')
  const title =
    amount >= 0
      ? `+${Math.abs(amount)} монет`
      : `−${Math.abs(amount)} монет`

  return {
    id: item.id,
    type: item.type,
    title,
    description,
    amount,
    currency: 'COINS',
    status: 'completed',
    createdAt: item.createdAt,
    balanceAfter: typeof item.balanceAfter === 'number' ? item.balanceAfter : null,
    icon: iconForOperationType(item.type, amount >= 0),
  }
}

/**
 * Loads real coin ledger rows for the authenticated Mini App user.
 * Uses existing GET /api/profile/coin-history (Telegram initData / session auth).
 */
export async function getOperations(filter: OperationFilter = 'all'): Promise<Operation[]> {
  const initData = getTelegramInitData()
  const headers = new Headers({ Accept: 'application/json' })
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  const response = await fetch(
    apiUrl(`/api/profile/coin-history?filter=${encodeURIComponent(filter)}`),
    {
      method: 'GET',
      headers,
      credentials: 'include',
    },
  )

  const payload = (await response.json().catch(() => null)) as CoinHistoryApiResponse | null
  if (!payload) {
    throw new Error('bad_response')
  }

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'history_unavailable')
  }

  return (payload.transactions ?? []).map(mapTransaction)
}
