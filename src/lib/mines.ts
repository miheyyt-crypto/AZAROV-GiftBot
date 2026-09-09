import { applyAccountSnapshot } from '@/lib/account'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { getTelegramInitData } from '@/lib/telegram'
import { mapRemoteAccount } from '@/lib/session'
import { createPurchaseRequestId } from '@/lib/shop'
import type { MinesGame } from '@/types/mines'
import type { UserAccount } from '@/types/account'

type MinesApiResponse = {
  success: boolean
  message?: string
  code?: string
  alreadyProcessed?: boolean
  hitMine?: boolean
  game?: MinesGame | null
  user?: UserAccount
}

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

async function minesRequest(path: string, init: RequestInit = {}): Promise<MinesApiResponse> {
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
  const payload = (await response.json().catch(() => null)) as MinesApiResponse | null
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

const pending = new Map<string, Promise<MinesApiResponse>>()

async function once(key: string, run: () => Promise<MinesApiResponse>): Promise<MinesApiResponse> {
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

export async function fetchActiveMinesGame(): Promise<MinesApiResponse> {
  const result = await minesRequest('/api/mines/active', { method: 'GET' })
  applyRemoteUser(result.user)
  return result
}

export async function startMinesGame(input: {
  bet: number
  mineCount: number
  requestId?: string
}): Promise<MinesApiResponse> {
  const requestId = input.requestId || createPurchaseRequestId()
  return once(`start:${requestId}`, async () => {
    const result = await minesRequest('/api/mines/start', {
      method: 'POST',
      body: JSON.stringify({
        bet: input.bet,
        mineCount: input.mineCount,
        requestId,
      }),
    })
    applyRemoteUser(result.user)
    return result
  })
}

export async function revealMinesCell(input: {
  gameId: string
  cellIndex: number
  requestId?: string
}): Promise<MinesApiResponse> {
  const requestId = input.requestId || createPurchaseRequestId()
  return once(`reveal:${input.gameId}:${input.cellIndex}`, async () => {
    const result = await minesRequest('/api/mines/reveal', {
      method: 'POST',
      body: JSON.stringify({
        gameId: input.gameId,
        cellIndex: input.cellIndex,
        requestId,
      }),
    })
    applyRemoteUser(result.user)
    return result
  })
}

export async function cashoutMinesGame(input: {
  gameId: string
  requestId?: string
}): Promise<MinesApiResponse> {
  const requestId = input.requestId || createPurchaseRequestId()
  return once(`cashout:${input.gameId}`, async () => {
    const result = await minesRequest('/api/mines/cashout', {
      method: 'POST',
      body: JSON.stringify({
        gameId: input.gameId,
        requestId,
      }),
    })
    applyRemoteUser(result.user)
    return result
  })
}
