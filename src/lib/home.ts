import { getTelegramInitData } from '@/lib/telegram'
import type { LeaderboardPlayer, RecentCaseDrop } from '@/types/home'

interface HomeApiResponse {
  success: boolean
  players?: LeaderboardPlayer[]
  drops?: RecentCaseDrop[]
}

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

async function request(path: string): Promise<HomeApiResponse> {
  const initData = getTelegramInitData()
  const headers = new Headers({ 'Content-Type': 'application/json' })

  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  const response = await fetch(apiUrl(path), {
    headers,
    credentials: 'include',
  })
  const payload = (await response.json().catch(() => null)) as HomeApiResponse | null

  if (!payload) {
    throw new Error('bad_response')
  }

  return payload
}

export function formatTimeAgo(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }

  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)

  if (minutes < 1) {
    return 'только что'
  }

  if (minutes < 60) {
    return `${minutes} мин назад`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} ч назад`
  }

  const days = Math.floor(hours / 24)
  return `${days} д назад`
}

export function getPlayerInitial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    return '?'
  }

  return trimmed.charAt(0).toUpperCase()
}

export async function fetchLeaderboard(): Promise<LeaderboardPlayer[] | null> {
  try {
    const result = await request('/api/home/leaderboard')
    if (result.success) {
      return result.players ?? []
    }
  } catch {
    return null
  }

  return null
}

export async function fetchRecentDrops(): Promise<RecentCaseDrop[] | null> {
  try {
    const result = await request('/api/home/recent-drops')
    if (result.success) {
      return result.drops ?? []
    }
  } catch {
    return null
  }

  return null
}
