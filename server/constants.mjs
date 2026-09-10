export const TELEGRAM_CHANNEL = '@azarov222'
export const TELEGRAM_BOT_USERNAME = 'AZAROV_GiftBot'
export const TELEGRAM_SUBSCRIBE_TASK_ID = 'telegram-subscribe'
export const TELEGRAM_SUBSCRIBE_REWARD = 500
export const LAUNCH_BOT_TASK_ID = 'launch-bot'
export const LAUNCH_BOT_REWARD = 600
/** Deep-link payload for https://t.me/BOT?start=launch_bot */
export const LAUNCH_BOT_START_PAYLOAD = 'launch_bot'
export const REFERRAL_INVITE_TASK_ID = 'referral-invite'
export const REFERRAL_INVITE_TASK_REQUIRED = 3
export const REFERRAL_INVITE_TASK_REWARD = 2000
/** Default coins granted to both referrer and invitee when invitee links Kick. */
export const REFERRAL_ACTIVATION_REWARD = 1000
export const REFERRAL_CASE_EVERY = 5
export const REFERRAL_CODE_PREFIX = 'ref_'
export const REFERRAL_CODE_LENGTH = 8
export const KICK_CONNECT_TASK_ID = 'kick-connect'
export const KICK_CONNECT_TASK_REWARD = 400
export const KICK_FOLLOW_TASK_ID = 'kick-follow'
export const KICK_FOLLOW_TASK_REWARD = 500
export const KICK_NICKNAME_TASK_ID = 'kick-nickname'
export const KICK_NICKNAME_TASK_REWARD = 400
/** Substring required in Kick username or display name (override with KICK_NICKNAME_TAG). */
export const KICK_NICKNAME_TAG_DEFAULT = 'azarov7777'
/** Default Kick channel slug for the follow task (override with KICK_REQUIRED_CHANNEL). */
export const KICK_REQUIRED_CHANNEL_DEFAULT = 'azarov7777'
/**
 * OAuth scopes for Kick account link + follow verification.
 * - user:read: identity (/public/v1/users)
 * - channel:read: channel metadata / followed-channels reads when available
 * Note: Kick Public API has no documented "is following?" endpoint; follow check
 * uses /public/v1/channels/followed (auth-gated) + optional channel.followed webhooks.
 */
export const KICK_OAUTH_SCOPES = 'user:read channel:read'
export const KICK_OAUTH_AUTHORIZE_URL = 'https://id.kick.com/oauth/authorize'
export const KICK_OAUTH_TOKEN_URL = 'https://id.kick.com/oauth/token'
export const KICK_API_USERS_URL = 'https://api.kick.com/public/v1/users'
export const KICK_API_CHANNELS_URL = 'https://api.kick.com/public/v1/channels'
export const KICK_API_CHANNELS_FOLLOWED_URL = 'https://api.kick.com/public/v1/channels/followed'
export const KICK_API_LIVESTREAMS_URL = 'https://api.kick.com/public/v1/livestreams'
export const KICK_API_EVENTS_SUBSCRIPTIONS_URL = 'https://api.kick.com/public/v1/events/subscriptions'
export const KICK_API_PUBLIC_KEY_URL = 'https://api.kick.com/public/v1/public-key'
export const KICK_OAUTH_STATE_TTL_MS = 10 * 60 * 1000
/**
 * Calendar-day boundary for Kick chat streak.
 * Kick event timestamps are ISO/UTC; store ledgers use UTC ISO — keep streak days in UTC.
 */
export const KICK_STREAK_TIMEZONE = 'UTC'
/** Product id / inventory type for streak freeze (usable only after admin approve → inventory). */
export const STREAK_FREEZE_PRODUCT_ID = 'streak-freeze'

export function getKickRequiredChannel() {
  const raw = String(process.env.KICK_REQUIRED_CHANNEL || KICK_REQUIRED_CHANNEL_DEFAULT)
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
  return raw || KICK_REQUIRED_CHANNEL_DEFAULT
}

export function getKickRequiredChannelUrl() {
  return `https://kick.com/${getKickRequiredChannel()}`
}

export function getKickNicknameTag() {
  const raw = String(process.env.KICK_NICKNAME_TAG || KICK_NICKNAME_TAG_DEFAULT).trim()
  return raw || KICK_NICKNAME_TAG_DEFAULT
}

/**
 * Production-tunable referral coin reward.
 * Prefer REFERRAL_REWARD; REFERRAL_ACTIVATION_REWARD env is accepted as an alias.
 */
export function getReferralActivationReward() {
  const raw = process.env.REFERRAL_REWARD || process.env.REFERRAL_ACTIVATION_REWARD
  if (raw === undefined || raw === '') {
    return REFERRAL_ACTIVATION_REWARD
  }

  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    return REFERRAL_ACTIVATION_REWARD
  }

  return value
}
