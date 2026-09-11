import { applyAccountSnapshot } from '@/lib/account'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { getTelegramInitData } from '@/lib/telegram'
import { mapRemoteAccount } from '@/lib/session'
import { createPurchaseRequestId } from '@/lib/shop'
import type { RollStatePayload } from '@/types/roll'
import type { UserAccount } from '@/types/account'

type RollApiResponse = RollStatePayload & {
  user?: UserAccount
}

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

async function rollRequest(path: string, init: RequestInit = {}): Promise<RollApiResponse> {
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
  const payload = (await response.json().catch(() => null)) as RollApiResponse | null
  if (!payload) {
    return {
      success: false,
      code: 'BAD_RESPONSE',
      message: 'Пустой ответ сервера.',
      round: null,
      lastResult: null,
      previousGame: null,
      topGame: null,
      serverNow: new Date().toISOString(),
      serverNowMs: Date.now(),
      viewerInRound: false,
      config: {
        maxPlayers: 2,
        minBet: 100,
        bettingDurationMs: 20_000,
        spinDurationMs: 5_000,
        resultHoldMs: 8_000,
        payoutBps: 10_000,
        quickBets: [100, 250, 500, 1000, 2500],
      },
    }
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

const pending = new Map<string, Promise<RollApiResponse>>()

async function once(key: string, run: () => Promise<RollApiResponse>): Promise<RollApiResponse> {
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

export async function fetchRollState(): Promise<RollApiResponse> {
  const result = await rollRequest('/api/roll/state', { method: 'GET' })
  applyRemoteUser(result.user)
  return result
}

export async function placeRollBet(input: {
  bet: number
  requestId?: string
}): Promise<RollApiResponse> {
  const requestId = input.requestId || createPurchaseRequestId()
  return once(`bet:${requestId}`, async () => {
    const result = await rollRequest('/api/roll/bet', {
      method: 'POST',
      body: JSON.stringify({
        bet: input.bet,
        requestId,
      }),
    })
    applyRemoteUser(result.user)
    return result
  })
}
