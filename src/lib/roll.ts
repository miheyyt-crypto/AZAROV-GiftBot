import { applyAccountSnapshot } from '@/lib/account'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { getTelegramInitData } from '@/lib/telegram'
import { mapRemoteAccount } from '@/lib/session'
import { createPurchaseRequestId } from '@/lib/shop'
import type { RollStatePayload } from '@/types/roll'
import type { UserAccount } from '@/types/account'

type RollApiResponse = RollStatePayload & {
  user?: UserAccount
  clientSentAt?: number
  clientReceivedAt?: number
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
        maxPlayers: 1000,
        minBet: 100,
        bettingDurationMs: 20_000,
        spinDurationMs: 10_000,
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
  const clientSentAt = Date.now()
  const result = await rollRequest('/api/roll/state', { method: 'GET' })
  const clientReceivedAt = Date.now()
  applyRemoteUser(result.user)
  return {
    ...result,
    clientSentAt,
    clientReceivedAt,
  }
}

export async function placeRollBet(input: {
  bet: number
  requestId?: string
}): Promise<RollApiResponse> {
  const requestId = input.requestId || createPurchaseRequestId()
  return once(`bet:${requestId}`, async () => {
    const clientSentAt = Date.now()
    const result = await rollRequest('/api/roll/bet', {
      method: 'POST',
      body: JSON.stringify({
        bet: input.bet,
        requestId,
      }),
    })
    const clientReceivedAt = Date.now()
    applyRemoteUser(result.user)
    return {
      ...result,
      clientSentAt,
      clientReceivedAt,
    }
  })
}

/**
 * SSE stream via fetch (supports Authorization header — EventSource cannot).
 * Returns an abort function.
 */
export function subscribeRollStream(
  onSnapshot: (payload: RollApiResponse) => void,
  onStatus?: (status: 'open' | 'error' | 'closed') => void,
): () => void {
  const controller = new AbortController()
  let closed = false

  const run = async () => {
    while (!closed && !controller.signal.aborted) {
      try {
        const initData = getTelegramInitData()
        const headers = new Headers()
        if (initData) {
          headers.set('Authorization', `tma ${initData}`)
        }
        const response = await fetch(apiUrl('/api/roll/stream'), {
          method: 'GET',
          headers,
          credentials: 'include',
          signal: controller.signal,
        })
        if (!response.ok || !response.body) {
          onStatus?.('error')
          await sleep(1_200)
          continue
        }
        onStatus?.('open')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!closed) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() || ''
          for (const chunk of parts) {
            const lines = chunk.split('\n')
            let data = ''
            for (const line of lines) {
              if (line.startsWith('data:')) {
                data += line.slice(5).trim()
              }
            }
            if (!data) {
              continue
            }
            try {
              const payload = JSON.parse(data) as RollApiResponse
              if (payload && typeof payload === 'object') {
                applyRemoteUser(payload.user)
                onSnapshot({
                  ...payload,
                  clientSentAt: Date.now(),
                  clientReceivedAt: Date.now(),
                })
              }
            } catch {
              // ignore malformed
            }
          }
        }
        onStatus?.('closed')
      } catch (error) {
        if (controller.signal.aborted || closed) {
          break
        }
        onStatus?.('error')
        await sleep(1_500)
      }
    }
  }

  void run()

  return () => {
    closed = true
    controller.abort()
    onStatus?.('closed')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
