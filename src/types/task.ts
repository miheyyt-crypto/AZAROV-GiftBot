export type TaskCategory = 'kick' | 'telegram' | 'social'

export type TaskStatus = 'available' | 'in_progress' | 'completed' | 'locked'

export type TaskType =
  | 'kick_nickname'
  | 'kick_connect'
  | 'kick_follow'
  | 'telegram_subscribe'
  | 'referral'

export interface ReferralProgress {
  current: number
  required: number
}

export interface TaskProgress {
  current: number
  required: number
  label?: string
}

export interface Task {
  id: string
  title: string
  description: string
  category: TaskCategory
  reward: number
  type: TaskType
  status: TaskStatus
  icon: string
  completed?: boolean
  rewardClaimed?: boolean
  progress?: TaskProgress
}

export type FilterCategory = 'all' | TaskCategory | 'partners'

export type PartnerTheme = 'dragonmoney' | 'stake'

export interface Partner {
  id: string
  name: string
  description: string
  reward: number
  rewardSuffix?: string
  theme: PartnerTheme
  image?: string
}
