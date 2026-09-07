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
  // Ensure WebApp.ready() runs before we read initData / start_param.
  initTelegramWebApp()

  // Mini App: signed initData is the source of truth.
  if (isMiniAppAuthAvailable()) {
    const user = getTelegramUser()
    setCurrentTelegramId(user.id)

    try {
      const response = await bootstrapRemoteSession(getStartParam())
      if (response.user) {
        applyAccountSnapshot(
          mapRemoteAccount({
            ...response.user,
            referralLink: response.user.referralLink || response.referralStats?.referralLink || '',
          }),
        )
      }
      // Start param is only needed for the first authenticated bootstrap.
      if (response.referral?.applied || response.referral?.reason === 'already_referred') {
        clearStoredStartParam()
      } else if (response.referral?.reason === 'invalid_code' || response.referral?.reason === 'self_referral') {
        clearStoredStartParam()
      }
    } catch {
      // Keep local snapshot if API is unavailable inside Telegram.
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
