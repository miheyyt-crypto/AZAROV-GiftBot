export type GiveawayStatus = 'active' | 'completed'

export type GiveawayTab = GiveawayStatus

export type GiveawayPrizeType = 'coins' | 'custom' | 'text'

export type GiveawayWinner = {
  userId: number
  username: string | null
  firstName: string | null
  photoUrl: string | null
}

export type Giveaway = {
  id: string
  title: string
  description?: string
  image: string
  status: GiveawayStatus
  prizeType?: GiveawayPrizeType
  prizeAmount?: number | null
  prizeText?: string | null
  coinsAmount?: number | null
  customPrize?: string | null
  winnersCount: number
  participantsCount?: number
  startAt?: string
  endAt?: string
  createdAt?: string
  completedAt?: string | null
  /** Alias for UI cards (completedAt || endAt). */
  endedAt?: string
  isParticipating?: boolean
  winners?: GiveawayWinner[]
  prizeDeliveryStatus?: 'pending' | 'delivered' | null
}

export type GiveawayParticipantState = {
  participating: boolean
  alreadyParticipating?: boolean
  participantsCount: number
}

export type GiveawaysLoadState = 'loading' | 'ready' | 'error'

export type GiveawaysResponse = {
  success: boolean
  giveaways?: Giveaway[]
  code?: string
  message?: string
}

export type GiveawayResponse = {
  success: boolean
  giveaway?: Giveaway
  code?: string
  message?: string
}

export type ParticipateGiveawayResponse = {
  success: boolean
  participating?: boolean
  alreadyParticipating?: boolean
  participantsCount?: number
  giveaway?: Giveaway
  code?: string
  message?: string
}
