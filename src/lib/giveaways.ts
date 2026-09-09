import { filterGiveawaysByStatus, MOCK_GIVEAWAYS } from '@/data/giveaways'
import { getTelegramInitData } from '@/lib/telegram'
import type { Giveaway, GiveawayStatus } from '@/types/giveaway'

interface GiveawaysApiResponse {
  success?: boolean
  giveaways?: Giveaway[]
  items?: Giveaway[]
}

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

function normalizeGiveaway(raw: Partial<Giveaway> & { id?: string | number }): Giveaway | null {
  const id = String(raw.id || '').trim()
  const title = String(raw.title || '').trim()
  const image = String(raw.image || '').trim()
  const status = raw.status === 'active' || raw.status === 'completed' ? raw.status : null
  const winnersCount = Number(raw.winnersCount)

  if (!id || !title || !image || !status || !Number.isFinite(winnersCount) || winnersCount < 0) {
    return null
  }

  return {
    id,
    title,
    image,
    status,
    winnersCount: Math.floor(winnersCount),
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
    endedAt: raw.endedAt ? String(raw.endedAt) : undefined,
  }
}

async function requestGiveawaysApi(): Promise<Giveaway[] | null> {
  const initData = getTelegramInitData()
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  try {
    const response = await fetch(apiUrl('/api/giveaways'), {
      headers,
      credentials: 'include',
    })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json().catch(() => null)) as GiveawaysApiResponse | null
    const list = payload?.giveaways ?? payload?.items
    if (!Array.isArray(list)) {
      return null
    }

    return list.map(normalizeGiveaway).filter((item): item is Giveaway => Boolean(item))
  } catch {
    return null
  }
}

/**
 * Load giveaways for Home / Giveaways page.
 * Prefers GET /api/giveaways when available; otherwise uses local mock catalog.
 */
export async function fetchGiveaways(): Promise<{ items: Giveaway[]; fromMock: boolean }> {
  const remote = await requestGiveawaysApi()
  if (remote) {
    return { items: remote, fromMock: false }
  }
  return { items: MOCK_GIVEAWAYS.map((item) => ({ ...item })), fromMock: true }
}

export function getGiveawaysByTab(items: Giveaway[], status: GiveawayStatus): Giveaway[] {
  return filterGiveawaysByStatus(items, status)
}

/** Russian plural for «N победитель(я/ей)». */
export function formatWinnersLabel(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  const mod10 = n % 10
  const mod100 = n % 100

  if (mod100 >= 11 && mod100 <= 14) {
    return `${n} победителей`
  }
  if (mod10 === 1) {
    return `${n} победитель`
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${n} победителя`
  }
  return `${n} победителей`
}
