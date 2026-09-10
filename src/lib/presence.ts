import { getTelegramInitData } from '@/lib/telegram'

const PRESENCE_PING_INTERVAL_MS = 30_000

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

export async function pingPresence(): Promise<void> {
  const initData = getTelegramInitData()
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  try {
    await fetch(apiUrl('/api/presence/ping'), {
      method: 'POST',
      headers,
      credentials: 'include',
      body: '{}',
    })
  } catch {
    // Presence is best-effort — never break the app.
  }
}
