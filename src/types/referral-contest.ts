export type ReferralContestStatus = 'scheduled' | 'active' | 'ended' | 'disabled'

export interface ReferralContestPrize {
  place: number
  amount: number
}

export interface ReferralContestVisibility {
  enabled: boolean
  adminOnly: boolean
  visible: boolean
  status: ReferralContestStatus
  endsAt: string
  startsAt: string
  prizePool: number
}

export interface ReferralContestPlayer {
  rank: number
  username: string
  displayName: string
  photoUrl: string
  score: number
  prize: number
  isMe?: boolean
}

export interface ReferralContestReferral {
  id: string
  referredUserId: number
  username: string
  displayName: string
  photoUrl: string
  kickLinked: boolean
  kickUsername: string
  createdAt: string | null
  activatedAt: string | null
  status: string
}

export interface ReferralContestMotivation {
  kind: 'start' | 'leader' | 'climb' | 'enter_top'
  title: string
  needed?: number
  targetRank?: number | null
  targetScore?: number
  myScore?: number
  currentRank?: number
  rivalRank?: number
  rivalScore?: number
  leadBy?: number
  prize?: number
  currentPrize?: number
  nextPrize?: number
}

export interface ReferralContestMe {
  rank: number | null
  score: number
  invitedTotal: number
  kickLinkedCount: number
  withoutKickCount: number
  potentialPrize: number
  inTop10: boolean
  isLeader: boolean
  participating: boolean
}

export interface ReferralContestPayload {
  success: boolean
  code?: string
  message?: string
  contest?: {
    id: string
    title: string
    enabled: boolean
    adminOnly: boolean
    startsAt: string
    endsAt: string
    prizePool: number
    prizes: ReferralContestPrize[]
    status: ReferralContestStatus
  }
  top3?: ReferralContestPlayer[]
  top10?: ReferralContestPlayer[]
  players?: ReferralContestPlayer[]
  me?: ReferralContestMe
  motivation?: ReferralContestMotivation
  referrals?: ReferralContestReferral[]
  referralLink?: string | null
  serverNow?: string
}
