export type GiveawayStatus = 'active' | 'completed'

export type GiveawayTab = GiveawayStatus

export type GiveawayPrizeType = 'coins' | 'custom' | 'text'

export type GiveawayEligibility = 'all' | 'category_a' | 'category_b'

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
  /** Telegram file_id; Mini App loads via /api/giveaways/:id/image when set. */
  imageFileId?: string | null
  status: GiveawayStatus
  prizeType?: GiveawayPrizeType
  prizeAmount?: number | null
  prizeText?: string | null
  coinsAmount?: number | null
  customPrize?: string | null
  winnersCount: number
  participantsCount?: number
  /** Who may join; missing/legacy → treated as all. */
  eligibility?: GiveawayEligibility
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
  /** Present when code is GIVEAWAY_NOT_ELIGIBLE. */
  requirement?: GiveawayEligibility
}
