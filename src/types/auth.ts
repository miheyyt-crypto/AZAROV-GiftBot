import type { TelegramUser } from '@/types/user'

/** Payload returned by the official Telegram Login Widget (data-onauth). */
export interface TelegramLoginWidgetUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface AuthState {
  status: AuthStatus
  user: TelegramUser | null
  error: string | null
}
