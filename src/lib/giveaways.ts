import { MOCK_GIVEAWAYS } from '@/data/giveaways'
import { normalizeGiveawayEligibility } from '@/lib/giveaway-eligibility'
import { getTelegramInitData } from '@/lib/telegram'
import type {
  Giveaway,
  GiveawayResponse,
  GiveawaysResponse,
  GiveawayStatus,
  ParticipateGiveawayResponse,
} from '@/types/giveaway'

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

/** Prefer custom Telegram image proxy when imageFileId is present. */
export function resolveGiveawayImageSrc(giveaway: Pick<Giveaway, 'id' | 'image' | 'imageFileId'>): string {
  if (giveaway.imageFileId) {
    return apiUrl(`/api/giveaways/${encodeURIComponent(giveaway.id)}/image`)
  }
  return giveaway.image
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T | null }> {
  const initData = getTelegramInitData()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      headers,
      credentials: 'include',
    })
    const data = (await response.json().catch(() => null)) as T | null
    return { ok: response.ok, status: response.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}

function normalizeGiveaway(raw: Partial<Giveaway> & { id?: string | number }): Giveaway | null {
  const id = String(raw.id || '').trim()
  const title = String(raw.title || '').trim()
  const image = String(raw.image || '').trim()
  const status = raw.status === 'active' || raw.status === 'completed' ? raw.status : null
  const winnersCount = Number(raw.winnersCount)

  if (!id || !title || !image || !status || !Number.isFinite(winnersCount) || winnersCount < 0) {
    return null
  }

  return {
    id,
    title,
    description: raw.description ? String(raw.description) : '',
    image,
    imageFileId:
      raw.imageFileId != null && String(raw.imageFileId).trim()
        ? String(raw.imageFileId).trim()
        : null,
    status,
    prizeType:
      raw.prizeType === 'coins' || raw.prizeType === 'custom' || raw.prizeType === 'text'
        ? raw.prizeType === 'text'
          ? 'custom'
          : raw.prizeType
        : undefined,
    prizeAmount: raw.prizeAmount == null ? null : Number(raw.prizeAmount),
    prizeText: raw.prizeText == null ? null : String(raw.prizeText),
    coinsAmount:
      raw.coinsAmount != null
        ? Number(raw.coinsAmount)
        : raw.prizeType === 'coins'
          ? Number(raw.prizeAmount)
          : null,
    customPrize:
      raw.customPrize != null
        ? String(raw.customPrize)
        : raw.prizeType === 'custom' || raw.prizeType === 'text'
          ? String(raw.prizeText || '')
          : null,
    winnersCount: Math.floor(winnersCount),
    participantsCount: Math.max(0, Math.floor(Number(raw.participantsCount) || 0)),
    eligibility: normalizeGiveawayEligibility(raw.eligibility),
    startAt: raw.startAt ? String(raw.startAt) : undefined,
    endAt: raw.endAt ? String(raw.endAt) : undefined,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
    completedAt: raw.completedAt ? String(raw.completedAt) : null,
    endedAt: raw.endedAt
      ? String(raw.endedAt)
      : raw.completedAt
        ? String(raw.completedAt)
        : raw.endAt
          ? String(raw.endAt)
          : undefined,
    isParticipating: Boolean(raw.isParticipating),
    winners: Array.isArray(raw.winners) ? raw.winners : undefined,
  }
}

export async function getGiveaways(): Promise<GiveawaysResponse> {
  const result = await requestJson<GiveawaysResponse>('/api/giveaways')
  if (!result.data) {
    return { success: false, code: 'NETWORK_ERROR', message: 'Не удалось загрузить розыгрыши.' }
  }
  if (!result.ok || !result.data.success || !Array.isArray(result.data.giveaways)) {
    return {
      success: false,
      code: result.data.code || 'LOAD_FAILED',
      message: result.data.message || 'Не удалось загрузить розыгрыши.',
    }
  }

  return {
    success: true,
    giveaways: result.data.giveaways
      .map((item) => normalizeGiveaway(item))
      .filter((item): item is Giveaway => Boolean(item)),
  }
}

export async function getGiveaway(giveawayId: string): Promise<GiveawayResponse> {
  const id = encodeURIComponent(String(giveawayId || '').trim())
  const result = await requestJson<GiveawayResponse>(`/api/giveaways/${id}`)
  if (!result.data) {
    return { success: false, code: 'NETWORK_ERROR', message: 'Не удалось загрузить розыгрыш.' }
  }
  if (!result.ok || !result.data.success || !result.data.giveaway) {
    return {
      success: false,
      code: result.data.code || 'LOAD_FAILED',
      message: result.data.message || 'Розыгрыш не найден.',
    }
  }
  const giveaway = normalizeGiveaway(result.data.giveaway)
  if (!giveaway) {
    return { success: false, code: 'BAD_PAYLOAD', message: 'Некорректные данные розыгрыша.' }
  }
  return { success: true, giveaway }
}

export async function participateGiveaway(giveawayId: string): Promise<ParticipateGiveawayResponse> {
  const id = encodeURIComponent(String(giveawayId || '').trim())
  const result = await requestJson<ParticipateGiveawayResponse>(`/api/giveaways/${id}/participate`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  if (!result.data) {
    return { success: false, code: 'NETWORK_ERROR', message: 'Не удалось записаться в розыгрыш.' }
  }
  if (!result.ok || !result.data.success) {
    return {
      success: false,
      code: result.data.code || 'PARTICIPATE_FAILED',
      message: result.data.message || 'Не удалось записаться в розыгрыш.',
      requirement: result.data.requirement
        ? normalizeGiveawayEligibility(result.data.requirement)
        : undefined,
      missing: Array.isArray(result.data.missing) ? result.data.missing.map(String) : undefined,
      giveaway: result.data.giveaway
        ? normalizeGiveaway(result.data.giveaway) || undefined
        : undefined,
    }
  }
  return {
    success: true,
    participating: true,
    alreadyParticipating: Boolean(result.data.alreadyParticipating),
    participantsCount: Number(result.data.participantsCount) || 0,
    giveaway: result.data.giveaway ? normalizeGiveaway(result.data.giveaway) || undefined : undefined,
  }
}

/**
 * Home / list loader. Production never silently falls back to mock data.
 * Dev-only mock fallback keeps local UI workable without API.
 */
export async function fetchGiveaways(): Promise<{ items: Giveaway[]; fromMock: boolean }> {
  const result = await getGiveaways()
  if (result.success && Array.isArray(result.giveaways)) {
    return { items: result.giveaways, fromMock: false }
  }

  if (import.meta.env.DEV) {
    console.warn('[giveaways] API unavailable in DEV — using mock catalog', result.message)
    return { items: MOCK_GIVEAWAYS.map((item) => ({ ...item })), fromMock: true }
  }

  throw new Error(result.message || 'giveaways_load_failed')
}

export function getGiveawaysByTab(items: Giveaway[], status: GiveawayStatus): Giveaway[] {
  return items.filter((item) => item.status === status)
}

/** Russian plural for «N победитель(я/ей)». */
export function formatWinnersLabel(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  const mod10 = n % 10
  const mod100 = n % 100

  if (mod100 >= 11 && mod100 <= 14) {
    return `${n} победителей`
  }
  if (mod10 === 1) {
    return `${n} победитель`
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${n} победителя`
  }
  return `${n} победителей`
}

export function formatParticipantsLabel(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) {
    return `${n} участников`
  }
  if (mod10 === 1) {
    return `${n} участник`
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${n} участника`
  }
  return `${n} участников`
}

export function formatPrizeLabel(
  giveaway: Pick<
    Giveaway,
    'prizeType' | 'prizeAmount' | 'prizeText' | 'coinsAmount' | 'customPrize'
  >,
): string {
  const type = giveaway.prizeType === 'text' ? 'custom' : giveaway.prizeType
  if (type === 'coins') {
    const amount = Number(giveaway.coinsAmount ?? giveaway.prizeAmount) || 0
    return `🪙 ${amount.toLocaleString('ru-RU')} монет`
  }
  const custom = String(giveaway.customPrize || giveaway.prizeText || 'Приз').trim()
  return `🎁 ${custom}`
}

export function formatCountdown(endAt: string | undefined, nowMs = Date.now()): string {
  if (!endAt) {
    return '—'
  }
  const endMs = Date.parse(endAt)
  if (!Number.isFinite(endMs)) {
    return '—'
  }
  const diff = Math.max(0, endMs - nowMs)
  const totalSec = Math.floor(diff / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  if (hours >= 100) {
    const days = Math.floor(hours / 24)
    return `${days}д ${pad(hours % 24)}:${pad(minutes)}:${pad(seconds)}`
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}
