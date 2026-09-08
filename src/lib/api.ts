import { getTelegramInitData } from '@/lib/telegram'
import type { UserAccount } from '@/types/account'
import type { CaseOpening } from '@/types/case'
import type { PartnerSubmission } from '@/types/partner'
import type { ShopOrder } from '@/types/shop'

export interface ApiUserResponse {
  success: boolean
  message?: string
  code?: string
  user?: UserAccount
  order?: ShopOrder
  orders?: ShopOrder[]
  opening?: CaseOpening
  submission?: PartnerSubmission
  submissions?: PartnerSubmission[]
  states?: Record<string, PartnerSubmission>
  completedTaskIds?: string[]
  startedPartnerTasks?: string[]
  referralCode?: string
  referralLink?: string
  invitedCount?: number
  activeCount?: number
  earnedCoins?: number
  caseProgress?: number
  caseTarget?: number
  availableReferralCases?: number
  referral?: {
    applied: boolean
    reason: string
    message?: string
  }
  completed?: boolean
  alreadyCompleted?: boolean
  rewarded?: boolean
  reward?: number
  following?: boolean
  activation?: {
    success?: boolean
    rewarded?: boolean
    reason?: string
    message?: string
  }
  referralStats?: {
    referralCode: string
    referralLink: string
    invitedCount: number
    activeCount: number
    pendingCount: number
    earnedCoins: number
    caseProgress?: number
    caseTarget?: number
    availableReferralCases?: number
  }
}

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL ?? ''
  return `${base}${path}`
}

async function request(path: string, init: RequestInit = {}): Promise<ApiUserResponse> {
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

  const payload = (await response.json().catch(() => null)) as ApiUserResponse | null

  if (!payload) {
    throw new Error('bad_response')
  }

  return payload
}

export function bootstrapRemoteSession(startParam: string): Promise<ApiUserResponse> {
  return request('/api/session', {
    method: 'POST',
    body: JSON.stringify({ startParam }),
  })
}

export function checkTelegramSubscribe(requestId: string): Promise<ApiUserResponse> {
  return request('/api/tasks/telegram-subscribe/check', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  })
}

export function checkKickFollow(requestId: string): Promise<ApiUserResponse> {
  return request('/api/tasks/kick-follow/check', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  })
}

export function checkKickNickname(requestId: string): Promise<ApiUserResponse> {
  return request('/api/tasks/kick-nickname/check', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  })
}

export function claimInviteFriendsTask(requestId: string): Promise<ApiUserResponse> {
  return request('/api/tasks/invite-friends/claim', {
    method: 'POST',
    body: JSON.stringify({ requestId }),
  })
}

export function activateReferralRemote(): Promise<ApiUserResponse> {
  return request('/api/referrals/activate', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function startPartnerTask(taskId: string): Promise<ApiUserResponse> {
  return request('/api/partners/tasks/start', {
    method: 'POST',
    body: JSON.stringify({ taskId }),
  })
}

export function getPartnerTasksState(): Promise<ApiUserResponse> {
  return request('/api/partners/tasks', {
    method: 'GET',
  })
}

export function getMyPartnerSubmissions(): Promise<ApiUserResponse> {
  return request('/api/partners/submissions/my', {
    method: 'GET',
  })
}

export async function createPartnerSubmissionRequest(input: {
  taskId: string
  partnerAccountId: string
  requestId: string
  screenshot: File
}): Promise<ApiUserResponse> {
  const initData = getTelegramInitData()
  const body = new FormData()
  body.set('taskId', input.taskId)
  body.set('partnerAccountId', input.partnerAccountId)
  body.set('requestId', input.requestId)
  body.set('screenshot', input.screenshot)

  const headers = new Headers()
  if (initData) {
    headers.set('Authorization', `tma ${initData}`)
  }

  const response = await fetch(apiUrl('/api/partners/submissions'), {
    method: 'POST',
    headers,
    body,
    credentials: 'include',
  })

  const payload = (await response.json().catch(() => null)) as ApiUserResponse | null
  if (!payload) {
    throw new Error('bad_response')
  }

  return payload
}

export function purchaseProductRequest(
  productId: string,
  requestId: string,
  metadata?: Record<string, string>,
): Promise<ApiUserResponse> {
  return request('/api/shop/purchase', {
    method: 'POST',
    body: JSON.stringify({ productId, requestId, metadata: metadata ?? {} }),
  })
}

export function getUserOrdersRequest(): Promise<ApiUserResponse> {
  return request('/api/shop/orders', {
    method: 'GET',
  })
}

export function getOrderRequest(orderId: string): Promise<ApiUserResponse> {
  return request(`/api/shop/orders/${orderId}`, {
    method: 'GET',
  })
}

export function cancelOrderRequest(orderId: string): Promise<ApiUserResponse> {
  return request(`/api/shop/orders/${orderId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function openCaseRequest(caseId: string, requestId: string): Promise<ApiUserResponse> {
  return request('/api/cases/open', {
    method: 'POST',
    body: JSON.stringify({ caseId, requestId }),
  })
}

export function getReferralMe(): Promise<ApiUserResponse> {
  return request('/api/referral/me', {
    method: 'GET',
  })
}

export function loginWithTelegramWeb(payload: {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}): Promise<ApiUserResponse> {
  return request('/api/auth/telegram-web', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function logoutWebSession(): Promise<ApiUserResponse> {
  return request('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function fetchAuthMe(): Promise<ApiUserResponse> {
  return request('/api/auth/me', {
    method: 'GET',
  })
}
