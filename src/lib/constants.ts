export const APP_NAME = 'AZAROV — GiftBot'

export const ROUTES = {
  home: '/',
  tasks: '/tasks',
  shop: '/shop',
  friends: '/friends',
  profile: '/profile',
  operations: '/profile/operations',
  orders: '/orders',
  giveaways: '/giveaways',
} as const

export const TELEGRAM_BOT_USERNAME = 'AZAROV_GiftBot'
export const TELEGRAM_CHANNEL = '@azarov222'
export const TELEGRAM_CHANNEL_URL = 'https://t.me/azarov222'
export const KICK_REQUIRED_CHANNEL = 'azarov7777'
export const KICK_REQUIRED_CHANNEL_URL = 'https://kick.com/azarov7777'

/** Bot username for Telegram Login Widget (no @). Overridable via Vite env. */
export function getTelegramLoginBotUsername(): string {
  const fromEnv = String(import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '')
    .trim()
    .replace(/^@/, '')
  return fromEnv || TELEGRAM_BOT_USERNAME
}

export const REFERRAL_CODE_PREFIX = 'ref_'
export const REFERRAL_ACTIVATION_REWARD = 1000
export const REFERRAL_CASE_EVERY = 5
export const REFERRAL_INVITE_TASK_ID = 'referral-invite'
export const REFERRAL_INVITE_TASK_REQUIRED = 3

/** Auto-advance interval for the Home banner slider. */
export const HOME_BANNER_AUTOPLAY_MS = 15_000

/** Poll interval for live home leaderboard and case drops. */
export const HOME_FEED_POLL_MS = 8_000
