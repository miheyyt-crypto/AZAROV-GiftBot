import {
  applyAccountSnapshot,
  getCurrentAccount,
  setCurrentTelegramId,
} from '@/lib/account'
import { bootstrapRemoteSession, MultiAccountBlockedError } from '@/lib/api'
import {
  isMiniAppAuthAvailable,
  restoreWebSession,
} from '@/lib/auth'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { emitLevelUpCelebration } from '@/lib/level-up-events'
import { parseLevelRewardGrants } from '@/lib/level-rewards'
import { clearStoredStartParam, getStartParam } from '@/lib/referral'
import { sessionBootLog } from '@/lib/session-boot-log'
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
    lastDailyFreeCaseAt: remote.lastDailyFreeCaseAt ?? null,
    dailyFreeCaseAvailable:
      remote.dailyFreeCaseAvailable == null ? true : Boolean(remote.dailyFreeCaseAvailable),
    dailyFreeCaseAvailableAt: remote.dailyFreeCaseAvailableAt ?? null,
    freeCase: remote.freeCase
      ? {
          kickLinked: Boolean(remote.freeCase.kickLinked),
          telegramTaskCompleted: Boolean(remote.freeCase.telegramTaskCompleted),
          cooldownExpired: Boolean(remote.freeCase.cooldownExpired),
          canOpen: Boolean(remote.freeCase.canOpen),
        }
      : undefined,
    gramBalance: Number(remote.gramBalance) || 0,
    chatMessages: remote.chatMessages ?? 0,
    watchSeconds: remote.watchSeconds ?? 0,
    streamHours: remote.streamHours ?? 0,
    level: remote.level ?? 1,
    xp: remote.xp ?? 0,
    xpForCurrentLevel: remote.xpForCurrentLevel ?? 0,
    xpForNextLevel: remote.xpForNextLevel ?? 200,
    xpProgress: remote.xpProgress ?? 0,
    nextLevelReward: remote.nextLevelReward ?? 0,
    claimedLevelRewards: Array.isArray(remote.claimedLevelRewards)
      ? remote.claimedLevelRewards
      : [],
    blocked: Boolean(remote.blocked),
    blockReason: remote.blockReason ?? null,
    blockedAt: remote.blockedAt ?? null,
    antiAbuseBound: remote.antiAbuseBound,
  }
}

/** Temporary boot diagnostics — correlate with Railway `[referral] session_*` + ECONNABORTED. */
export { sessionBootLog } from '@/lib/session-boot-log'

/**
 * In-flight dedupe: React StrictMode remount + parallel callers (AuthGate / account hooks)
 * must share one POST /api/session. Without this, cleanup discards the first success while a
 * sibling request is aborted (server logs ECONNABORTED) and sessionReady never flips.
 */
let bootstrapInflight: Promise<BootstrapSessionResult> | null = null

export type BootstrapSessionResult = {
  account: UserAccount
  /** True only when the server confirmed the session (not local/cache fallback). */
  confirmed: boolean
}

async function runBootstrapSession(): Promise<BootstrapSessionResult> {
  sessionBootLog('request started')
  // Capture launch start_param BEFORE ready() — hash/query can disappear afterward.
  const startParam = captureStartParam() || getStartParam()

  initTelegramWebApp()

  // Re-read after WebApp init in case initData became available only now.
  const resolvedStartParam = captureStartParam() || startParam

  // Mini App: client initData is only a transport credential — server must confirm.
  if (isMiniAppAuthAvailable()) {
    const user = getTelegramUser()
    setCurrentTelegramId(user.id)

    try {
      const response = await bootstrapRemoteSession(resolvedStartParam)
      sessionBootLog('response parsed', {
        success: response.success,
        hasUser: Boolean(response.user),
        code: response.code || null,
      })
      if (response.user) {
        applyAccountSnapshot(
          mapRemoteAccount({
            ...response.user,
            referralLink: response.user.referralLink || response.referralStats?.referralLink || '',
          }),
        )
      }

      const granted = parseLevelRewardGrants(response.levelRewards?.granted)
      const totalAmount = Math.max(
        0,
        Math.floor(Number(response.levelRewards?.totalAmount) || 0),
      )
      if (granted.length > 0 && totalAmount > 0) {
        emitLevelUpCelebration({ rewards: granted, totalAmount })
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

      hydrateBalanceFromAccount()
      const confirmed = Boolean(response.user)
      sessionBootLog('request finished', { confirmed, path: 'miniapp' })
      return { account: getCurrentAccount(), confirmed }
    } catch (error) {
      const aborted =
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error &&
          (error.name === 'AbortError' || /aborted|AbortError/i.test(error.message)))
      sessionBootLog('request finished', {
        confirmed: false,
        path: 'miniapp',
        aborted,
        error: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : String(error),
      })
      if (error instanceof MultiAccountBlockedError) {
        throw error
      }
      // Abort/cancel is not MULTI_ACCOUNT; fall through as unconfirmed so AuthGate can retry.
      hydrateBalanceFromAccount()
      return { account: getCurrentAccount(), confirmed: false }
    }
  }

  // Website: restore HttpOnly cookie session if present.
  const webUser = await restoreWebSession()
  if (webUser) {
    sessionBootLog('request finished', { confirmed: true, path: 'web' })
    return { account: getCurrentAccount(), confirmed: true }
  }

  hydrateBalanceFromAccount()
  sessionBootLog('request finished', { confirmed: false, path: 'web' })
  return { account: getCurrentAccount(), confirmed: false }
}

export function bootstrapSession(): Promise<BootstrapSessionResult> {
  if (!bootstrapInflight) {
    bootstrapInflight = runBootstrapSession().finally(() => {
      bootstrapInflight = null
    })
  } else {
    sessionBootLog('request joined inflight')
  }
  return bootstrapInflight
}
