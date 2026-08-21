import { applyAccountSnapshot, getCurrentAccount } from '@/lib/account'
import { mapRemoteAccount } from '@/lib/session'
import { getTelegramInitData } from '@/lib/telegram'
import { getUserStats } from '@/lib/user'
import { getAchievements } from '@/data/achievements'
import type {
  AchievementProgress,
  CoinHistoryFilter,
  CoinTransaction,
  InventoryItem,
} from '@/types/profile'
import type { ShopOrder } from '@/types/shop'
import type { UserAccount } from '@/types/account'

export interface ProfileApiResponse {
  success: boolean
  message?: string
  user?: UserAccount
  transactions?: CoinTransaction[]
  items?: InventoryItem[]
  achievements?: AchievementProgress[]
  orders?: ShopOrder[]
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
}

async function request(path: string): Promise<ProfileApiResponse> {
  const initData = getTelegramInitData()
  const headers = new Headers({ 'Content-Type': 'application/json' })

  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  const response = await fetch(apiUrl(path), { headers })
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

export async function fetchInventory(): Promise<InventoryItem[]> {
  try {
    const result = await getInventoryRequest()
    applyRemoteUser(result.user)
    return result.items ?? []
  } catch {
    return []
  }
}

export function getLocalAchievementsProgress(): AchievementProgress[] {
  const account = getCurrentAccount()
  const stats = getUserStats()

  const progressMap: Record<string, number> = {
    'stream-hours': stats.streamHours,
    'chat-messages': stats.chatMessages,
    friends: account.invitedCount,
    'coins-earned': account.referralEarnings,
  }

  return getAchievements().map((item) => {
    const raw = progressMap[item.id] ?? 0
    const current = Math.min(raw, item.target)

    return {
      ...item,
      current,
      completed: raw >= item.target,
      claimed: false,
    }
  })
}

export async function fetchAchievements(): Promise<AchievementProgress[]> {
  try {
    const result = await getAchievementsRequest()
    applyRemoteUser(result.user)
    if (result.success && result.achievements?.length) {
      return result.achievements
    }
  } catch {
    // API unavailable — use local definitions below.
  }

  return getLocalAchievementsProgress()
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
