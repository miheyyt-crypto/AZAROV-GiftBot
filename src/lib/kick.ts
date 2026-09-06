import { getTelegramInitData } from '@/lib/telegram'
import { activateReferralRemote } from '@/lib/api'
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

  if (connection.connected) {
    void activateReferralRemote().catch(() => {
      // Idempotent: referral rewards are already granted on registration bind.
    })
  }

  return getKickConnection()
}

export function isKickOAuthConfigured(): boolean {
  return API_BASE_URL.length > 0
}

export function getKickOAuthUrl(): string | null {
  if (!isKickOAuthConfigured()) {
    return null
  }

  const initData = getTelegramInitData()
  const params = new URLSearchParams()

  if (initData) {
    params.set('initData', initData)
  }

  const query = params.toString()
  return `${API_BASE_URL}/api/auth/kick${query ? `?${query}` : ''}`
}

export async function initiateKickOAuth(): Promise<{
  success: boolean
  message?: string
}> {
  if (!isKickOAuthConfigured()) {
    return {
      success: false,
      message: 'Привязка Kick будет доступна после подключения OAuth.',
    }
  }

  const oauthUrl = getKickOAuthUrl()

  if (!oauthUrl) {
    return {
      success: false,
      message: 'Не удалось подготовить OAuth-ссылку.',
    }
  }

  window.location.href = oauthUrl

  return { success: true }
}
