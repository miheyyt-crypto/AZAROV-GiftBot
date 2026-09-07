import {
  applyAccountSnapshot,
  getCurrentAccount,
  setCurrentTelegramId,
} from '@/lib/account'
import { bootstrapRemoteSession } from '@/lib/api'
import {
  isMiniAppAuthAvailable,
  restoreWebSession,
} from '@/lib/auth'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { clearStoredStartParam, getStartParam } from '@/lib/referral'
import { captureStartParam } from '@/lib/startParam'
import { initTelegramWebApp } from '@/lib/telegram'
import { getTelegramUser } from '@/lib/user'
import type { UserAccount } from '@/types/account'

export function mapRemoteAccount(remote: UserAccount): UserAccount {
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
    kickConnected: remote.kickConnected,
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

export async function bootstrapSession(): Promise<UserAccount> {
  // Capture launch start_param BEFORE ready() — hash/query can disappear afterward.
  const startParam = captureStartParam() || getStartParam()

  initTelegramWebApp()

  // Re-read after WebApp init in case initData became available only now.
  const resolvedStartParam = captureStartParam() || startParam

  // Mini App: signed initData is the source of truth.
  if (isMiniAppAuthAvailable()) {
    const user = getTelegramUser()
    setCurrentTelegramId(user.id)

    try {
      const response = await bootstrapRemoteSession(resolvedStartParam)
      if (response.user) {
        applyAccountSnapshot(
          mapRemoteAccount({
            ...response.user,
            referralLink: response.user.referralLink || response.referralStats?.referralLink || '',
          }),
        )
      }

      const reason = response.referral?.reason
      if (
        response.referral?.applied ||
        reason === 'already_referred' ||
        reason === 'invalid_code' ||
        reason === 'self_referral' ||
        reason === 'already_invited' ||
        reason === 'no_code'
      ) {
        // Keep storage on network/auth failure so a retry can still bind.
        if (response.success !== false) {
          clearStoredStartParam()
        }
      }
    } catch {
      // Keep local snapshot + stored start_param if API is unavailable inside Telegram.
    }

    hydrateBalanceFromAccount()
    return getCurrentAccount()
  }

  // Website: restore HttpOnly cookie session if present.
  const webUser = await restoreWebSession()
  if (webUser) {
    return getCurrentAccount()
  }

  hydrateBalanceFromAccount()
  return getCurrentAccount()
}
