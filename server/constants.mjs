export const TELEGRAM_CHANNEL = '@azarov222'
export const TELEGRAM_BOT_USERNAME = 'AZAROV_GiftBot'
export const TELEGRAM_SUBSCRIBE_TASK_ID = 'telegram-subscribe'
export const TELEGRAM_SUBSCRIBE_REWARD = 500
export const REFERRAL_INVITE_TASK_ID = 'referral-invite'
export const REFERRAL_INVITE_TASK_REQUIRED = 3
export const REFERRAL_INVITE_TASK_REWARD = 2000
/** Default coins granted to both referrer and invitee on first successful referral bind. */
export const REFERRAL_ACTIVATION_REWARD = 500
export const REFERRAL_CASE_EVERY = 5
export const REFERRAL_CODE_PREFIX = 'ref_'
export const REFERRAL_CODE_LENGTH = 8

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
