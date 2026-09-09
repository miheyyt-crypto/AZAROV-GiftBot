export type GiveawayStatus = 'active' | 'completed'

export type GiveawayTab = GiveawayStatus

export type Giveaway = {
  id: string
  title: string
  image: string
  status: GiveawayStatus
  winnersCount: number
  createdAt?: string
  endedAt?: string
}

export type GiveawaysLoadState = 'loading' | 'ready' | 'error'
