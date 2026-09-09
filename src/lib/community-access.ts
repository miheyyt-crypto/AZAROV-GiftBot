import { getTelegramInitData } from '@/lib/telegram'
import type {
  CommunityAccessStatusResponse,
  CommunityAccessSubmitResponse,
} from '@/types/community-access'

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

export const COMMUNITY_ACCESS_MAX_BYTES = 5 * 1024 * 1024

export function normalizeUsernameInput(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
}

export function isValidTelegramUsername(raw: string): boolean {
  const value = normalizeUsernameInput(raw)
  return /^[a-zA-Z0-9_]{5,32}$/.test(value)
}

export function normalizeWelvuraIdInput(raw: string): string {
  return String(raw || '').trim()
}

export function isValidWelvuraId(raw: string): boolean {
  const value = normalizeWelvuraIdInput(raw)
  return /^\d{1,32}$/.test(value)
}

export async function getCommunityAccessStatus(): Promise<CommunityAccessStatusResponse> {
  const initData = getTelegramInitData()
  const headers = new Headers()
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  try {
    const response = await fetch(apiUrl('/api/community-access/status'), {
      method: 'GET',
      headers,
      credentials: 'include',
    })
    const data = (await response.json().catch(() => null)) as CommunityAccessStatusResponse | null
    if (!data) {
      return { success: false, message: 'Не удалось загрузить статус заявки.' }
    }
    return data
  } catch {
    return { success: false, message: 'Не удалось загрузить статус заявки.' }
  }
}

export async function submitCommunityAccessRequest(input: {
  welvuraId: string
  username: string
  requestId: string
  screenshot: File
}): Promise<CommunityAccessSubmitResponse> {
  const initData = getTelegramInitData()
  const body = new FormData()
  body.set('welvuraId', input.welvuraId)
  body.set('username', input.username)
  body.set('requestId', input.requestId)
  body.set('screenshot', input.screenshot)

  const headers = new Headers()
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  try {
    const response = await fetch(apiUrl('/api/community-access/request'), {
      method: 'POST',
      headers,
      body,
      credentials: 'include',
    })
    const data = (await response.json().catch(() => null)) as CommunityAccessSubmitResponse | null
    if (!data) {
      return { success: false, message: 'Не удалось отправить заявку.' }
    }
    return data
  } catch {
    return { success: false, message: 'Не удалось отправить заявку.' }
  }
}
