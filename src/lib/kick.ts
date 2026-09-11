import { applyAccountSnapshot, getCurrentAccount } from '@/lib/account'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { mapRemoteAccount } from '@/lib/session'
import { getTelegramInitData, getTelegramWebApp } from '@/lib/telegram'
import type { KickConnection } from '@/types'
import type { KickStreakInfo } from '@/types/kick'
import type { UserAccount } from '@/types/account'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? ''

let kickConnection: KickConnection = {
  connected: false,
}

export function getKickConnection(): KickConnection {
  return { ...kickConnection }
}

export function setKickConnection(connection: KickConnection): KickConnection {
  kickConnection = { ...connection }
  return getKickConnection()
}

export function applyKickConnectionFromAccount(account: {
  kickConnected?: boolean
  kickUsername?: string | null
  kickUserId?: string | null
  kickAvatarUrl?: string | null
  kickDisplayName?: string | null
}): KickConnection {
  return setKickConnection({
    connected: Boolean(account.kickConnected || account.kickUserId),
    username: account.kickUsername || undefined,
    userId: account.kickUserId || undefined,
    avatarUrl: account.kickAvatarUrl || undefined,
    displayName: account.kickDisplayName || undefined,
  })
}

/**
 * Refresh Kick link status from the server and sync UserAccount.
 * Source of truth is backend (Telegram session), never client-supplied Kick ids.
 */
export async function refreshKickAccountState(): Promise<KickConnection> {
  try {
    const result = await kickRequest('/api/kick/me', { method: 'GET' })
    if (result.connection) {
      setKickConnection(result.connection)
    } else if (result.user) {
      applyKickConnectionFromAccount(result.user)
    }

    if (result.user) {
      const account = getCurrentAccount()
      if (account.telegramId > 0) {
        applyAccountSnapshot(
          mapRemoteAccount({
            ...account,
            ...result.user,
            telegramId: result.user.telegramId || account.telegramId,
            kickConnected: Boolean(
              result.user.kickConnected ||
                result.connection?.connected ||
                result.user.kickUserId ||
                result.connection?.userId,
            ),
            kickUserId:
              result.user.kickUserId ||
              result.connection?.userId ||
              account.kickUserId ||
              null,
            kickUsername:
              result.user.kickUsername ||
              result.connection?.username ||
              account.kickUsername ||
              null,
            kickAvatarUrl:
              result.user.kickAvatarUrl ||
              result.connection?.avatarUrl ||
              account.kickAvatarUrl ||
              null,
          } as UserAccount),
        )
        hydrateBalanceFromAccount()
      } else {
        applyKickConnectionFromAccount(result.user)
      }
    }

    return getKickConnection()
  } catch {
    return getKickConnection()
  }
}

let kickPollTimer: ReturnType<typeof setInterval> | null = null

export function stopKickConnectionPolling(): void {
  if (kickPollTimer) {
    clearInterval(kickPollTimer)
    kickPollTimer = null
  }
}

/** Poll Kick link status while the user finishes OAuth in an external browser. */
export function startKickConnectionPolling(options?: {
  intervalMs?: number
  timeoutMs?: number
  onConnected?: (connection: KickConnection) => void
}): void {
  stopKickConnectionPolling()
  const intervalMs = options?.intervalMs ?? 2500
  const timeoutMs = options?.timeoutMs ?? 120_000
  const startedAt = Date.now()

  kickPollTimer = setInterval(() => {
    void refreshKickAccountState().then((connection) => {
      if (connection.connected) {
        stopKickConnectionPolling()
        options?.onConnected?.(connection)
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        stopKickConnectionPolling()
      }
    })
  }, intervalMs)
}

export async function fetchKickStreak(): Promise<KickStreakInfo | null> {
  try {
    const initData = getTelegramInitData()
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    if (initData) {
      headers.set('Authorization', `tma ${initData}`)
    }

    const response = await fetch(`${API_BASE_URL}/api/kick/streak`, {
      method: 'GET',
      headers,
      credentials: 'include',
    })

    const payload = (await response.json().catch(() => null)) as KickStreakInfo | null
    if (!payload || payload.success === false) {
      return null
    }

    return {
      success: true,
      kickConnected: Boolean(payload.kickConnected),
      kickUsername: payload.kickUsername ?? null,
      kickUserId: payload.kickUserId ?? null,
      currentStreak: Number(payload.currentStreak) || 0,
      lastActiveDate: payload.lastActiveDate || null,
      creditedToday: Boolean(payload.creditedToday),
      todayDate: payload.todayDate,
      timezone: payload.timezone,
      channel: payload.channel,
      message: payload.message ?? null,
      freezeAvailable: Number(payload.freezeAvailable) || 0,
      freezeAutoConsume: Boolean(payload.freezeAutoConsume),
      progressCurrent:
        payload.progressCurrent != null
          ? Number(payload.progressCurrent) || 0
          : Number(payload.currentStreak) || 0,
      progressRequired:
        payload.progressRequired != null
          ? Math.max(1, Number(payload.progressRequired) || 1)
          : (Number(payload.currentStreak) || 0) + 1,
      nextReward: Math.max(0, Math.floor(Number(payload.nextReward) || 0)),
      isLive: Boolean(payload.isLive),
      channelSlug: payload.channelSlug || payload.channel || undefined,
      channelAvatarUrl: payload.channelAvatarUrl ?? null,
    }
  } catch {
    return null
  }
}

async function kickRequest(path: string, init: RequestInit = {}): Promise<{
  success: boolean
  message?: string
  code?: string
  authorizationUrl?: string
  configured?: boolean
  connection?: KickConnection
  user?: {
    telegramId?: number
    kickConnected?: boolean
    kickUsername?: string | null
    kickUserId?: string | null
    kickAvatarUrl?: string | null
    claimedTaskIds?: string[]
    completedTasks?: string[]
    balance?: number
  }
}> {
  const initData = getTelegramInitData()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean
    message?: string
    code?: string
    authorizationUrl?: string
    configured?: boolean
    connection?: KickConnection
    user?: {
      telegramId?: number
      kickConnected?: boolean
      kickUsername?: string | null
      kickUserId?: string | null
      kickAvatarUrl?: string | null
      claimedTaskIds?: string[]
      completedTasks?: string[]
      balance?: number
    }
  } | null

  if (!payload) {
    throw new Error('bad_response')
  }

  return {
    success: Boolean(payload.success),
    message: payload.message,
    code: payload.code,
    authorizationUrl: payload.authorizationUrl,
    configured: payload.configured,
    connection: payload.connection,
    user: payload.user,
  }
}

export async function fetchKickConnectionRemote(): Promise<KickConnection> {
  return refreshKickAccountState()
}

export function isKickOAuthConfigured(): boolean {
  // Same-origin production works with empty VITE_API_URL; capability comes from backend.
  return true
}

export async function initiateKickOAuth(): Promise<{
  success: boolean
  message?: string
  code?: string
}> {
  try {
    const result = await kickRequest('/api/kick/oauth/start', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    if (result.connection) {
      setKickConnection(result.connection)
    } else if (result.user) {
      applyKickConnectionFromAccount(result.user)
    }

    if (result.code === 'already_connected') {
      return {
        success: false,
        code: result.code,
        message: result.message || 'Kick уже подключён.',
      }
    }

    if (!result.success || !result.authorizationUrl) {
      return {
        success: false,
        code: result.code,
        message:
          result.message ||
          'Привязка Kick пока недоступна. Попробуй позже.',
      }
    }

    const webApp = getTelegramWebApp()
    if (webApp?.openLink) {
      webApp.openLink(result.authorizationUrl)
    } else {
      window.location.href = result.authorizationUrl
    }

    // OAuth finishes in an external browser; Mini App must poll until linked.
    startKickConnectionPolling()

    return { success: true }
  } catch {
    return {
      success: false,
      code: 'network_error',
      message: 'Не удалось начать привязку Kick. Попробуй позже.',
    }
  }
}

export function consumeKickReturnQuery(): {
  status: string
  message: string
} | null {
  if (typeof window === 'undefined') {
    return null
  }

  const params = new URLSearchParams(window.location.search)
  const status = params.get('kick')?.trim()
  if (!status) {
    return null
  }

  const message = params.get('kickMessage')?.trim() || ''
  params.delete('kick')
  params.delete('kickMessage')
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', next)

  return { status, message }
}
