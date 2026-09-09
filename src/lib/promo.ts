import { applyAccountSnapshot } from '@/lib/account'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { getTelegramInitData } from '@/lib/telegram'
import { mapRemoteAccount } from '@/lib/session'
import type { UserAccount } from '@/types/account'

export type PromoRedeemResponse = {
  success: boolean
  message?: string
  code?: string
  reward?: number
  newBalance?: number
  alreadyProcessed?: boolean
  user?: UserAccount
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

export function normalizePromoInput(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

export function promoErrorMessage(code?: string, fallback?: string): string {
  switch (code) {
    case 'PROMO_NOT_FOUND':
      return 'Промокод не найден'
    case 'PROMO_EXHAUSTED':
      return 'Этот промокод больше недоступен'
    case 'PROMO_ALREADY_USED':
      return 'Ты уже использовал этот промокод'
    case 'PROMO_DISABLED':
      return 'Этот промокод больше не активен'
    case 'INVALID_CODE':
      return 'Введи корректный промокод'
    default:
      return fallback || 'Не удалось активировать промокод. Попробуй ещё раз.'
  }
}

export async function redeemPromoCode(code: string): Promise<PromoRedeemResponse> {
  const initData = getTelegramInitData()
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  const response = await fetch(apiUrl('/api/promo/redeem'), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ code: normalizePromoInput(code) }),
  })

  const payload = (await response.json().catch(() => null)) as PromoRedeemResponse | null
  if (!payload) {
    return { success: false, code: 'BAD_RESPONSE', message: 'Пустой ответ сервера.' }
  }

  applyRemoteUser(payload.user)
  return payload
}
