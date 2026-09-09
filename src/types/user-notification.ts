export type UserNotificationType =
  | 'PARTNER_SUBMISSION_APPROVED'
  | 'PARTNER_SUBMISSION_REJECTED'
  | 'ORDER_APPROVED'
  | 'ORDER_REJECTED'
  | 'COMMUNITY_ACCESS_APPROVED'
  | 'COMMUNITY_ACCESS_REJECTED'
  | 'SYSTEM'
  | string

export interface UserNotification {
  id: string
  type: UserNotificationType
  title: string
  message: string
  read: boolean
  createdAt: string
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  metadata?: {
    partnerId?: string | null
    partnerName?: string | null
    taskId?: string | null
    taskTitle?: string | null
    rejectionReason?: string | null
    reward?: number
    productId?: string | null
    productName?: string | null
    orderId?: string | null
    [key: string]: unknown
  }
}

export interface NotificationsListResponse {
  success: boolean
  notifications: UserNotification[]
  unreadCount: number
  message?: string
}
