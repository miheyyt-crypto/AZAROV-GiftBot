import { applyAccountSnapshot } from '@/lib/account'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { getTelegramInitData } from '@/lib/telegram'
import { mapRemoteAccount } from '@/lib/session'
import { createPurchaseRequestId } from '@/lib/shop'
import type { TowerGame } from '@/types/tower'
import type { UserAccount } from '@/types/account'

type TowerApiResponse = {
  success: boolean
  message?: string
  code?: string
  alreadyProcessed?: boolean
  hitDanger?: boolean
  game?: TowerGame | null
  user?: UserAccount
}

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

async function towerRequest(path: string, init: RequestInit = {}): Promise<TowerApiResponse> {
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
  const payload = (await response.json().catch(() => null)) as TowerApiResponse | null
  if (!payload) {
    return { success: false, code: 'BAD_RESPONSE', message: 'Пустой ответ сервера.' }
  }
  return payload
}

function applyRemoteUser(user: UserAccount | undefined): void {
  if (!user) {
    return
  }
  applyAccountSnapshot(mapRemoteAccount(user))
  hydrateBalanceFromAccount()
}

const pending = new Map<string, Promise<TowerApiResponse>>()

async function once(key: string, run: () => Promise<TowerApiResponse>): Promise<TowerApiResponse> {
  const existing = pending.get(key)
  if (existing) {
    return existing
  }
  const promise = run().finally(() => {
    pending.delete(key)
  })
  pending.set(key, promise)
  return promise
}

export async function fetchActiveTowerGame(): Promise<TowerApiResponse> {
  const result = await towerRequest('/api/tower/active', { method: 'GET' })
  applyRemoteUser(result.user)
  return result
}

export async function startTowerGame(input: {
  bet: number
  requestId?: string
}): Promise<TowerApiResponse> {
  const requestId = input.requestId || createPurchaseRequestId()
  return once(`tower-start:${requestId}`, async () => {
    const result = await towerRequest('/api/tower/start', {
      method: 'POST',
      body: JSON.stringify({ bet: input.bet, requestId }),
    })
    applyRemoteUser(result.user)
    return result
  })
}

export async function pickTowerCell(input: {
  gameId: string
  floor: number
  cellIndex: number
  requestId?: string
}): Promise<TowerApiResponse> {
  const requestId = input.requestId || createPurchaseRequestId()
  return once(`tower-pick:${input.gameId}:${input.floor}:${input.cellIndex}:${requestId}`, async () => {
    const result = await towerRequest('/api/tower/pick', {
      method: 'POST',
      body: JSON.stringify({
        gameId: input.gameId,
        floor: input.floor,
        cellIndex: input.cellIndex,
        requestId,
      }),
    })
    applyRemoteUser(result.user)
    return result
  })
}

export async function cashoutTowerGame(input: {
  gameId: string
  requestId?: string
}): Promise<TowerApiResponse> {
  const requestId = input.requestId || createPurchaseRequestId()
  return once(`tower-cashout:${input.gameId}:${requestId}`, async () => {
    const result = await towerRequest('/api/tower/cashout', {
      method: 'POST',
      body: JSON.stringify({ gameId: input.gameId, requestId }),
    })
    applyRemoteUser(result.user)
    return result
  })
}
