export type CommunityAccessStatus = 'pending' | 'approved' | 'rejected'

export type CommunityAccessRequest = {
  id: string
  telegramId: number
  username: string | null
  firstName: string | null
  status: CommunityAccessStatus
  createdAt: string
  reviewedAt?: string | null
  rejectionReason?: string | null
}

export type CommunityAccessStatusResponse = {
  success: boolean
  request?: CommunityAccessRequest | null
  canSubmit?: boolean
  code?: string
  message?: string
}

export type CommunityAccessSubmitResponse = {
  success: boolean
  request?: CommunityAccessRequest
  alreadyExists?: boolean
  code?: string
  message?: string
}
