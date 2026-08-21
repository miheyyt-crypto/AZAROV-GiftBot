import {
  applyAccountSnapshot,
  getCurrentAccount,
  setCurrentTelegramId,
} from '@/lib/account'
import { bootstrapRemoteSession } from '@/lib/api'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { getStartParam } from '@/lib/referral'
import { getTelegramInitData } from '@/lib/telegram'
import { getTelegramUser } from '@/lib/user'
import type { UserAccount } from '@/types/account'

export async function bootstrapSession(): Promise<UserAccount> {
  const user = getTelegramUser()
  setCurrentTelegramId(user.id)

  const initData = getTelegramInitData()

  if (!initData) {
    hydrateBalanceFromAccount()
    return getCurrentAccount()
  }

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
  } catch {
    // Keep local demo snapshot if API is unavailable.
  }

  hydrateBalanceFromAccount()
  return getCurrentAccount()
}

export function mapRemoteAccount(remote: UserAccount): UserAccount {
  return {
    telegramId: remote.telegramId,
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
