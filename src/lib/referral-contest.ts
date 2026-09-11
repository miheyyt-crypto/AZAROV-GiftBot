import { getTelegramInitData } from '@/lib/telegram'
import type { ReferralContestPayload } from '@/types/referral-contest'

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

export async function fetchReferralContest(): Promise<ReferralContestPayload> {
  const initData = getTelegramInitData()
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  const response = await fetch(apiUrl('/api/contest/referral'), {
    headers,
    credentials: 'include',
  })
  const payload = (await response.json().catch(() => null)) as ReferralContestPayload | null
  if (!payload) {
    return { success: false, code: 'BAD_RESPONSE', message: 'Не удалось загрузить конкурс.' }
  }
  return payload
}

export function formatContestCountdown(endsAt: string, nowMs = Date.now()): string {
  const end = Date.parse(endsAt)
  if (!Number.isFinite(end)) {
    return '—'
  }
  const diff = Math.max(0, end - nowMs)
  const totalMinutes = Math.floor(diff / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  return `${days} дн ${hours} ч ${minutes} мин`
}

export function formatCoinsAmount(amount: number): string {
  return Math.max(0, Math.floor(Number(amount) || 0)).toLocaleString('ru-RU')
}
