export interface UserAccount {
  telegramId: number
  username?: string
  firstName?: string
  lastName?: string
  photoUrl?: string
  referralCode: string
  referralLink?: string
  referredBy: string | null
  referredByUserId?: number | null
  balance: number
  invitedCount: number
  invitedUserIds: number[]
  activeReferrals: number
  pendingCount?: number
  referralEarnings: number
  kickConnected: boolean
  kickUserId?: string | null
  kickUsername?: string | null
  kickDisplayName?: string | null
  kickAvatarUrl?: string | null
  referralRewardGranted: boolean
  claimedTaskIds: string[]
  startedPartnerTasks?: string[]
  completedTasks?: string[]
  openedReferralCases?: number
  availableReferralCases?: number
  caseProgress?: number
  caseTarget?: number
  chatMessages?: number
  watchSeconds?: number
  streamHours?: number
  level?: number
  xp?: number
  xpForCurrentLevel?: number
  xpForNextLevel?: number
  xpProgress?: number
}

export interface AppStoreData {
  version: 1
  users: Record<string, UserAccount>
}

export interface ReferralApplyResult {
  applied: boolean
  reason:
    | 'applied'
    | 'no_code'
    | 'self_referral'
    | 'already_referred'
    | 'already_invited'
    | 'invalid_code'
}

export interface ReferralActivationResult {
  rewarded: boolean
  reason:
    | 'rewarded'
    | 'no_referrer'
    | 'already_granted'
    | 'self_referral'
    | 'kick_not_connected'
}
