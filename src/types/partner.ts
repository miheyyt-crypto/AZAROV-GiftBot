export type PartnerTaskStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'PENDING'
  | 'REJECTED'
  | 'COMPLETED'

export type PartnerVerificationType = 'account-link' | 'deposit'

export type PartnerTaskKind = 'account_link' | 'deposit'

export type PartnerSubmissionStatus = 'pending' | 'approved' | 'rejected'

export interface PartnerTaskConfig {
  id: string
  order: number
  type: PartnerTaskKind
  title: string
  description: string
  reward: number
  /** Deposit amount in rubles; only for deposit tasks. */
  depositAmount?: number
  actionUrl: string
  actionLabel?: string
  verificationType: PartnerVerificationType
}

export interface PartnerConfig {
  id: string
  name: string
  logo?: string
  logoImage?: string
  description: string
  modalDescription: string
  reward: number
  rewardSuffix?: string
  theme: 'dragonmoney' | 'stake'
  image?: string
  /** When true, partner banner is hidden from Tasks (config kept for later). */
  hidden?: boolean
  tasks: PartnerTaskConfig[]
}

export interface PartnerSubmission {
  submissionId: string
  telegramUserId: number
  partnerId: string
  partnerName?: string
  taskId: string
  taskTitle?: string
  partnerAccountId: string
  status: PartnerSubmissionStatus
  createdAt: string
  reviewedAt?: string | null
  rejectionReason?: string | null
  reward: number
}
