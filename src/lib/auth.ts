import {
  applyAccountSnapshot,
  clearCurrentAccount,
  getCurrentTelegramId,
} from '@/lib/account'
import {
  fetchAuthMe,
  loginWithTelegramWeb,
  logoutWebSession,
} from '@/lib/api'
import { setReferralContestVisibility } from '@/lib/contest-access'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import type { TelegramLoginWidgetUser } from '@/types/auth'
import type { UserAccount } from '@/types/account'
import type { TelegramUser } from '@/types/user'
import { getTelegramInitData, isTelegramWebApp } from '@/lib/telegram'

type AuthListener = () => void

let webUser: TelegramUser | null = null
const listeners = new Set<AuthListener>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function mapRemoteAccountLocal(remote: UserAccount): UserAccount {
  return {
    telegramId: remote.telegramId,
    username: remote.username,
    firstName: remote.firstName,
    lastName: remote.lastName,
    photoUrl: remote.photoUrl,
    referralCode: remote.referralCode,
    referralLink: remote.referralLink || '',
    referredBy: remote.referredBy,
    referredByUserId: remote.referredByUserId ?? null,
    balance: remote.balance,
    invitedCount: remote.invitedCount,
    invitedUserIds: remote.invitedUserIds ?? [],
    activeReferrals: remote.activeReferrals,
    pendingCount: remote.pendingCount ?? 0,
    referralEarnings: remote.referralEarnings,
    kickConnected: Boolean(remote.kickConnected || remote.kickUserId),
    kickUserId: remote.kickUserId ?? null,
    kickUsername: remote.kickUsername ?? null,
    kickDisplayName: remote.kickDisplayName ?? null,
    kickAvatarUrl: remote.kickAvatarUrl ?? null,
    referralRewardGranted: remote.referralRewardGranted,
    claimedTaskIds: remote.claimedTaskIds ?? remote.completedTasks ?? [],
    completedTasks: remote.completedTasks ?? remote.claimedTaskIds ?? [],
    startedPartnerTasks: remote.startedPartnerTasks ?? [],
    openedReferralCases: remote.openedReferralCases ?? 0,
    availableReferralCases: remote.availableReferralCases,
    caseProgress: remote.caseProgress,
    caseTarget: remote.caseTarget,
  }
}

export function subscribeAuth(listener: AuthListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getWebAuthUser(): TelegramUser | null {
  return webUser
}

export function setWebAuthUser(user: TelegramUser | null): void {
  webUser = user
  notify()
}

export function clearWebAuthState(): void {
  webUser = null
  setReferralContestVisibility(null)
  notify()
}

export function accountToTelegramUser(account: UserAccount): TelegramUser {
  return {
    id: account.telegramId,
    first_name: account.firstName || account.username || 'Игрок',
    last_name: account.lastName || undefined,
    username: account.username || undefined,
    photo_url: account.photoUrl || undefined,
    isDemo: false,
  }
}

export function applyAuthenticatedAccount(account: UserAccount): TelegramUser {
  const mapped = mapRemoteAccountLocal(account)
  applyAccountSnapshot(mapped)
  const user = accountToTelegramUser(mapped)
  setWebAuthUser(user)
  hydrateBalanceFromAccount()
  return user
}

/** True when running inside Telegram Mini App with signed initData. */
export function isMiniAppAuthAvailable(): boolean {
  return isTelegramWebApp() && Boolean(getTelegramInitData())
}

/**
 * Restore an existing HttpOnly web session (browser / website).
 * Returns the user on success, null if no valid session.
 */
export async function restoreWebSession(): Promise<TelegramUser | null> {
  try {
    const response = await fetchAuthMe()
    if (!response.success || !response.user) {
      clearWebAuthState()
      return null
    }

    setReferralContestVisibility(response.features?.referralContest || null)
    return applyAuthenticatedAccount(response.user)
  } catch {
    clearWebAuthState()
    return null
  }
}

/**
 * Complete Telegram Login Widget → backend verification → cookie session.
 */
export async function completeTelegramWebLogin(
  payload: TelegramLoginWidgetUser,
): Promise<{ user: TelegramUser; message?: string }> {
  const response = await loginWithTelegramWeb({
    id: payload.id,
    first_name: payload.first_name,
    ...(payload.last_name ? { last_name: payload.last_name } : {}),
    ...(payload.username ? { username: payload.username } : {}),
    ...(payload.photo_url ? { photo_url: payload.photo_url } : {}),
    auth_date: payload.auth_date,
    hash: payload.hash,
  })

  if (!response.success || !response.user) {
    if (response.code === 'MAINTENANCE') {
      throw new Error(response.message || 'Ведутся тех. работы')
    }
    throw new Error(response.message || 'Не удалось войти через Telegram.')
  }

  const user = applyAuthenticatedAccount(response.user)
  setReferralContestVisibility(response.features?.referralContest || null)
  return { user, message: response.message }
}

export async function logoutCurrentWebSession(): Promise<void> {
  try {
    await logoutWebSession()
  } catch {
    // Still clear local state if the network call fails.
  }

  clearWebAuthState()
  clearCurrentAccount()
  hydrateBalanceFromAccount()
}

export function hasLocalAuthenticatedUser(): boolean {
  if (isMiniAppAuthAvailable()) {
    return true
  }

  if (webUser && webUser.id > 0 && !webUser.isDemo) {
    return true
  }

  return getCurrentTelegramId() > 0
}
