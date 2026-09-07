import { getTelegramInitData, getTelegramWebApp } from '@/lib/telegram'
import type { KickConnection } from '@/types'

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
}): KickConnection {
  return setKickConnection({
    connected: Boolean(account.kickConnected || account.kickUserId),
    username: account.kickUsername || undefined,
    userId: account.kickUserId || undefined,
    avatarUrl: account.kickAvatarUrl || undefined,
  })
}

async function kickRequest(path: string, init: RequestInit = {}): Promise<{
  success: boolean
  message?: string
  code?: string
  authorizationUrl?: string
  configured?: boolean
  connection?: KickConnection
  user?: {
    kickConnected?: boolean
    kickUsername?: string | null
    kickUserId?: string | null
    kickAvatarUrl?: string | null
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
      kickConnected?: boolean
      kickUsername?: string | null
      kickUserId?: string | null
      kickAvatarUrl?: string | null
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
  try {
    const result = await kickRequest('/api/kick/me', { method: 'GET' })
    if (result.connection) {
      return setKickConnection(result.connection)
    }
    if (result.user) {
      return applyKickConnectionFromAccount(result.user)
    }
  } catch {
    // Keep last known local snapshot.
  }
  return getKickConnection()
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
          'Привязка Kick пока недоступна. Проверь KICK_CLIENT_ID / SECRET на сервере.',
      }
    }

    const webApp = getTelegramWebApp()
    if (webApp?.openLink) {
      webApp.openLink(result.authorizationUrl)
    } else {
      window.location.href = result.authorizationUrl
    }

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
