import { applyAccountSnapshot } from '@/lib/account'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { mapRemoteAccount } from '@/lib/session'
import { getTelegramInitData } from '@/lib/telegram'
import type {
  AchievementProgress,
  CaseOpeningItem,
  CoinHistoryFilter,
  CoinTransaction,
  InventoryItem,
} from '@/types/profile'
import type { ShopOrder } from '@/types/shop'
import type { UserAccount } from '@/types/account'

export interface ProfileApiResponse {
  success: boolean
  message?: string
  code?: string
  user?: UserAccount
  transactions?: CoinTransaction[]
  items?: InventoryItem[]
  caseOpenings?: CaseOpeningItem[]
  achievements?: AchievementProgress[]
  achievement?: AchievementProgress
  orders?: ShopOrder[]
  rewarded?: boolean
  alreadyClaimed?: boolean
  reward?: number
}

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

function applyRemoteUser(user: Parameters<typeof mapRemoteAccount>[0] | undefined): void {
  if (!user) {
    return
  }

  applyAccountSnapshot(mapRemoteAccount(user))
  hydrateBalanceFromAccount()
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<ProfileApiResponse> {
  const initData = getTelegramInitData()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')

  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: 'include',
  })
  const payload = (await response.json().catch(() => null)) as ProfileApiResponse | null

  if (!payload) {
    throw new Error('bad_response')
  }

  return payload
}

export async function fetchCoinHistory(
  filter: CoinHistoryFilter = 'all',
): Promise<CoinTransaction[]> {
  try {
    const result = await getCoinHistoryRequest(filter)
    applyRemoteUser(result.user)
    return result.transactions ?? []
  } catch {
    return []
  }
}

export async function fetchInventory(): Promise<{
  items: InventoryItem[]
  caseOpenings: CaseOpeningItem[]
}> {
  try {
    const result = await getInventoryRequest()
    applyRemoteUser(result.user)
    return {
      items: result.items ?? [],
      caseOpenings: result.caseOpenings ?? [],
    }
  } catch {
    return { items: [], caseOpenings: [] }
  }
}

export async function fetchAchievements(): Promise<AchievementProgress[]> {
  const result = await getAchievementsRequest()
  applyRemoteUser(result.user)
  if (result.success && Array.isArray(result.achievements)) {
    return result.achievements
  }
  throw new Error(result.message || 'Не удалось загрузить достижения.')
}

export async function claimAchievementReward(
  achievementId: string,
): Promise<{
  success: boolean
  message?: string
  code?: string
  achievements: AchievementProgress[]
  achievement?: AchievementProgress
}> {
  const result = await request(`/api/achievements/${encodeURIComponent(achievementId)}/claim`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  applyRemoteUser(result.user)
  return {
    success: Boolean(result.success),
    message: result.message,
    code: result.code,
    achievements: result.achievements ?? [],
    achievement: result.achievement,
  }
}

export async function fetchPendingOrders(): Promise<ShopOrder[]> {
  try {
    const result = await getPendingOrdersRequest()
    applyRemoteUser(result.user)
    return result.orders ?? []
  } catch {
    return []
  }
}

function getCoinHistoryRequest(
  filter: CoinHistoryFilter = 'all',
): Promise<ProfileApiResponse> {
  return request(`/api/profile/coin-history?filter=${filter}`)
}

function getInventoryRequest(): Promise<ProfileApiResponse> {
  return request('/api/profile/inventory')
}

function getAchievementsRequest(): Promise<ProfileApiResponse> {
  return request('/api/profile/achievements')
}

function getPendingOrdersRequest(): Promise<ProfileApiResponse> {
  return request('/api/profile/orders/pending')
}

export function formatTransactionDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function formatProgress(current: number, target: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(current)}/${new Intl.NumberFormat('ru-RU').format(target)}`
}
