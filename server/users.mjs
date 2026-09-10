import crypto from 'node:crypto'

import { hydrateAntiAbuseUserFields } from './anti-abuse.mjs'
import { REFERRAL_CASE_EVERY, REFERRAL_CODE_LENGTH, REFERRAL_CODE_PREFIX, TELEGRAM_BOT_USERNAME } from './constants.mjs'
import { buildUserLevelSnapshot } from './level.mjs'
import { nextLevelRewardAmount } from './level-rewards.mjs'
import { loadStore } from './store.mjs'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Coerce legacy / corrupt store values to a real array (objects are truthy and used to slip past `|| []`). */
export function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

export function getBotUsername() {
  const fromEnv = String(process.env.BOT_USERNAME || '')
    .trim()
    .replace(/^@/, '')
  return fromEnv || TELEGRAM_BOT_USERNAME
}

export function normalizeReferralCode(code) {
  const raw = String(code || '')
    .trim()
    .toUpperCase()

  if (!raw) {
    return ''
  }

  if (raw.startsWith(REFERRAL_CODE_PREFIX.toUpperCase())) {
    return raw.slice(REFERRAL_CODE_PREFIX.length)
  }

  return raw
}

/** Public form: ref_XXXXXXXX */
export function formatReferralCode(code) {
  const normalized = normalizeReferralCode(code)
  return normalized ? `${REFERRAL_CODE_PREFIX}${normalized}` : ''
}

/**
 * Accept both `ref_XXXXXXXX` (our public links) and bare `XXXXXXXX`
 * (Telegram startapp / manual deep links without prefix).
 */
export function extractReferralCode(startParam) {
  const raw = String(startParam || '').trim()
  if (!raw) {
    return null
  }

  const withPrefix = raw.match(/^ref_([A-Za-z0-9]{6,12})$/i)
  if (withPrefix) {
    return withPrefix[1].toUpperCase()
  }

  const bare = raw.match(/^([A-Za-z0-9]{6,12})$/)
  if (bare) {
    return bare[1].toUpperCase()
  }

  return null
}

/**
 * Pick the first usable referral payload from signed initData, client hint, or bot /start pending.
 */
export function resolveReferralStartParam({ signed = '', client = '', pending = '' } = {}) {
  const candidates = [
    { value: String(signed || '').trim(), source: 'init_data' },
    { value: String(client || '').trim(), source: 'client' },
    { value: String(pending || '').trim(), source: 'pending' },
  ]

  for (const candidate of candidates) {
    if (extractReferralCode(candidate.value)) {
      return candidate
    }
  }

  return { value: '', source: 'none' }
}

export function buildReferralLink(referralCode) {
  const code = normalizeReferralCode(referralCode)
  if (!code) {
    return ''
  }

  return `https://t.me/${getBotUsername()}?startapp=${REFERRAL_CODE_PREFIX}${code}`
}

export function generateReferralCode(store) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let body = ''
    const bytes = crypto.randomBytes(REFERRAL_CODE_LENGTH)

    for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
      body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
    }

    if (!store.referralIndex[body] && !store.referralIndex[`${REFERRAL_CODE_PREFIX}${body}`]) {
      return body
    }
  }

  throw new Error('referral_code_collision')
}

function isTelegramIdBasedCode(code, telegramId) {
  const normalized = normalizeReferralCode(code)
  return normalized === String(telegramId)
}

export function indexReferralCode(store, user) {
  const code = normalizeReferralCode(user.referralCode)
  if (!code) {
    return
  }

  user.referralCode = code
  store.referralIndex[code] = user.telegramId
}

export function createUser(store, telegramUser, options = {}) {
  const referralCode = generateReferralCode(store)
  const unbound = options.unbound === true
  const user = {
    telegramId: telegramUser.id,
    username: telegramUser.username || '',
    firstName: telegramUser.first_name || '',
    lastName: telegramUser.last_name || '',
    photoUrl: telegramUser.photo_url || '',
    balance: 0,
    referralCode,
    referredByUserId: null,
    referredBy: null,
    referralStatus: null,
    referralCreatedAt: null,
    referralActivatedAt: null,
    referralRewardClaimed: false,
    invitedUsers: [],
    activeReferrals: 0,
    completedTasks: [],
    startedPartnerTasks: [],
    orderIds: [],
    earnedRewards: [],
    referralEarnings: 0,
    kickVerified: false,
    kickUserId: null,
    kickUsername: null,
    kickDisplayName: null,
    kickAvatarUrl: null,
    kickLinkedAt: null,
    welvuraVerified: false,
    inviterRewardGranted: false,
    invitedRewardGranted: false,
    openedReferralCases: 0,
    caseOpenings: [],
    lastDailyFreeCaseAt: null,
    dailyFreeCaseOpenings: [],
    gramBalance: 0,
    dailyCaseItems: [],
    pendingStartParam: null,
    languageCode: telegramUser.language_code || '',
    isPremium: Boolean(telegramUser.is_premium),
    claimedLevelRewards: [],
    levelRewardsSeeded: true,
    createdAt: new Date().toISOString(),
    blocked: false,
    blockReason: null,
    blockedAt: null,
    primaryDeviceId: null,
    primaryIpHash: null,
    // Production registration is always bound — ban system removed.
    antiAbuseBound: true,
    antiAbuseLegacy: false,
  }

  hydrateAntiAbuseUserFields(user, { isNew: true })
  store.users[String(user.telegramId)] = user
  indexReferralCode(store, user)
  return user
}

function mapLegacyStatus(status) {
  if (status === 'INVITED') {
    return 'pending'
  }
  if (status === 'ACTIVE') {
    return 'active'
  }
  return status || 'pending'
}

export function referralPairKey(referrerUserId, referredUserId) {
  return `${referrerUserId}:${referredUserId}`
}

export function hydrateUserReferrals(store, user) {
  store.referrals = store.referrals || {}
  user.invitedUsers = ensureArray(user.invitedUsers)

  // One pass index — avoid O(invites × referrals) .find on every bootstrap.
  const referralByInvitee = new Map()
  for (const row of Object.values(store.referrals)) {
    const id = Number(row?.referredUserId)
    if (Number.isInteger(id) && id > 0 && !referralByInvitee.has(id)) {
      referralByInvitee.set(id, row)
    }
  }

  for (const item of user.invitedUsers) {
    const inviteeId = Number(item.telegramId)
    if (!Number.isInteger(inviteeId) || inviteeId <= 0) {
      continue
    }

    const key = referralPairKey(user.telegramId, inviteeId)
    const status = mapLegacyStatus(item.status)

    // Do not invent a second referrer row for an invitee already claimed elsewhere.
    const existingForInvitee = referralByInvitee.get(inviteeId)
    if (
      existingForInvitee &&
      Number(existingForInvitee.referrerUserId) !== Number(user.telegramId)
    ) {
      continue
    }

    if (!store.referrals[key]) {
      store.referrals[key] = {
        id: key,
        referrerUserId: user.telegramId,
        referredUserId: inviteeId,
        status: status === 'ACTIVE' ? 'active' : status,
        createdAt: item.createdAt || new Date().toISOString(),
        activatedAt:
          status === 'active' || status === 'rewarded'
            ? item.activatedAt || new Date().toISOString()
            : null,
        rewardedAt: status === 'rewarded' ? item.rewardedAt || null : null,
      }
      referralByInvitee.set(inviteeId, store.referrals[key])
    }

    const invitee = store.users[String(inviteeId)]
    if (invitee && !invitee.referredByUserId) {
      invitee.referredByUserId = user.telegramId
      invitee.referredBy = String(user.telegramId)
      invitee.referralStatus = invitee.referralStatus || store.referrals[key].status
      invitee.referralCreatedAt = invitee.referralCreatedAt || store.referrals[key].createdAt
    }
  }
}

export function ensureUser(store, telegramUser) {
  const existing = store.users[String(telegramUser.id)]

  if (!existing) {
    // Fail closed: new Telegram IDs must register via bootstrapUser + anti-abuse.
    throw new Error('user_not_registered')
  }

  const nextUsername = telegramUser.username || existing.username || ''
  const nextFirstName = telegramUser.first_name || existing.firstName || ''
  const nextLastName = telegramUser.last_name || existing.lastName || ''
  const nextPhotoUrl = telegramUser.photo_url || existing.photoUrl || ''
  if (existing.username !== nextUsername) existing.username = nextUsername
  if (existing.firstName !== nextFirstName) existing.firstName = nextFirstName
  if (existing.lastName !== nextLastName) existing.lastName = nextLastName
  if (existing.photoUrl !== nextPhotoUrl) existing.photoUrl = nextPhotoUrl
  if (telegramUser.language_code && existing.languageCode !== telegramUser.language_code) {
    existing.languageCode = telegramUser.language_code
  }
  if (typeof telegramUser.is_premium === 'boolean' && existing.isPremium !== telegramUser.is_premium) {
    existing.isPremium = telegramUser.is_premium
  }
  existing.invitedUsers = ensureArray(existing.invitedUsers)
  existing.orderIds = ensureArray(existing.orderIds)
  existing.startedPartnerTasks = ensureArray(existing.startedPartnerTasks)
  existing.completedTasks = ensureArray(existing.completedTasks)
  existing.earnedRewards = ensureArray(existing.earnedRewards)
  if (existing.referralEarnings == null) existing.referralEarnings = 0
  existing.kickVerified = Boolean(existing.kickVerified)
  existing.kickUserId = existing.kickUserId ?? null
  existing.kickUsername = existing.kickUsername ?? null
  existing.kickDisplayName = existing.kickDisplayName ?? null
  existing.kickAvatarUrl = existing.kickAvatarUrl ?? null
  existing.kickLinkedAt = existing.kickLinkedAt ?? null
  existing.welvuraVerified = Boolean(existing.welvuraVerified)
  existing.inviterRewardGranted = Boolean(existing.inviterRewardGranted)
  existing.invitedRewardGranted = Boolean(existing.invitedRewardGranted)
  if (!existing.openedReferralCases) existing.openedReferralCases = 0
  existing.caseOpenings = ensureArray(existing.caseOpenings)
  existing.referredByUserId = existing.referredByUserId ?? null
  existing.referralStatus = existing.referralStatus ?? null
  existing.referralCreatedAt = existing.referralCreatedAt ?? null
  existing.referralActivatedAt = existing.referralActivatedAt ?? null
  existing.referralRewardClaimed = Boolean(existing.referralRewardClaimed)
  if (existing.pendingStartParam === undefined) {
    existing.pendingStartParam = null
  }
  hydrateAntiAbuseUserFields(existing, { isNew: false })

  // Referral code is permanent: create once, never rotate (except one-time Telegram-ID legacy codes).
  if (!existing.referralCode) {
    existing.referralCode = generateReferralCode(store)
  } else if (isTelegramIdBasedCode(existing.referralCode, existing.telegramId)) {
    existing.referralCode = generateReferralCode(store)
  } else {
    const normalized = normalizeReferralCode(existing.referralCode)
    if (existing.referralCode !== normalized) {
      existing.referralCode = normalized
    }
  }

  indexReferralCode(store, existing)
  hydrateUserReferrals(store, existing)

  return existing
}

export function findUserByReferralCode(store, code) {
  const normalized = normalizeReferralCode(code)
  if (!normalized) {
    return null
  }

  const telegramId =
    store.referralIndex[normalized] ||
    store.referralIndex[`${REFERRAL_CODE_PREFIX}${normalized}`] ||
    store.referralIndex[`${REFERRAL_CODE_PREFIX.toUpperCase()}${normalized}`]

  if (!telegramId) {
    return null
  }

  return store.users[String(telegramId)] || null
}

export function getReferralsByReferrer(store, referrerUserId) {
  return Object.values(store.referrals || {}).filter(
    (item) => Number(item.referrerUserId) === Number(referrerUserId),
  )
}

export function countActiveReferrals(store, referrerUserId) {
  return getReferralsByReferrer(store, referrerUserId).filter(
    (item) => item.status === 'active' || item.status === 'rewarded',
  ).length
}

export function toPublicUser(user, store = null) {
  if (!user) {
    return null
  }

  const source = store || loadStore()
  const referrals = getReferralsByReferrer(source, user.telegramId)
  const invitedCount = referrals.length
  const pendingCount = referrals.filter((item) => item.status === 'pending').length
  const activeCount = referrals.filter(
    (item) => item.status === 'active' || item.status === 'rewarded',
  ).length
  const openedReferralCases = user.openedReferralCases || 0
  const earnedReferralCases = Math.floor(activeCount / REFERRAL_CASE_EVERY)
  const availableReferralCases = Math.max(0, earnedReferralCases - openedReferralCases)
  let caseProgress = activeCount % REFERRAL_CASE_EVERY
  if (availableReferralCases > 0 && caseProgress === 0) {
    caseProgress = REFERRAL_CASE_EVERY
  }

  const watchSeconds = Math.max(
    0,
    Math.floor(
      Number(source.kickWatchStats?.[String(user.telegramId)]?.totalWatchSeconds ?? user.watchSeconds) ||
        0,
    ),
  )
  const levelSnap = buildUserLevelSnapshot(user, watchSeconds)

  const lastDailyFreeCaseAt = user.lastDailyFreeCaseAt || null
  let dailyFreeCaseAvailable = true
  let dailyFreeCaseAvailableAt = null
  if (lastDailyFreeCaseAt) {
    const lastMs = Date.parse(lastDailyFreeCaseAt)
    if (Number.isFinite(lastMs)) {
      const nextMs = lastMs + 24 * 60 * 60 * 1000
      dailyFreeCaseAvailable = Date.now() >= nextMs
      dailyFreeCaseAvailableAt = new Date(nextMs).toISOString()
    }
  }

  const kickConnected = Boolean(user.kickVerified || user.kickUserId)
  const completedTasks = Array.isArray(user.completedTasks) ? user.completedTasks : []
  const telegramTaskCompleted = completedTasks.includes('telegram-subscribe')
  const freeCaseCanOpen = kickConnected && telegramTaskCompleted && dailyFreeCaseAvailable

  return {
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl,
    referralCode: formatReferralCode(user.referralCode),
    referredBy: user.referredByUserId ? String(user.referredByUserId) : user.referredBy,
    referredByUserId: user.referredByUserId || null,
    balance: user.balance,
    invitedCount,
    invitedUserIds: referrals.map((item) => item.referredUserId),
    activeReferrals: activeCount,
    pendingCount,
    referralEarnings: user.referralEarnings,
    kickConnected,
    kickUserId: user.kickUserId || null,
    kickUsername: user.kickUsername || null,
    kickDisplayName: user.kickDisplayName || null,
    kickAvatarUrl: user.kickAvatarUrl || null,
    welvuraVerified: Boolean(user.welvuraVerified),
    referralRewardGranted: user.invitedRewardGranted || user.referralRewardClaimed,
    claimedTaskIds: user.completedTasks,
    completedTasks: user.completedTasks,
    startedPartnerTasks: user.startedPartnerTasks || [],
    openedReferralCases,
    availableReferralCases,
    caseProgress,
    caseTarget: REFERRAL_CASE_EVERY,
    lastDailyFreeCaseAt,
    dailyFreeCaseAvailable,
    dailyFreeCaseAvailableAt,
    freeCase: {
      kickLinked: kickConnected,
      telegramTaskCompleted,
      cooldownExpired: dailyFreeCaseAvailable,
      canOpen: freeCaseCanOpen,
    },
    gramBalance: Number(user.gramBalance) || 0,
    referralLink: buildReferralLink(user.referralCode),
    chatMessages: levelSnap.chatMessages,
    watchSeconds: levelSnap.watchSeconds,
    streamHours: levelSnap.streamHours,
    level: levelSnap.level,
    xp: levelSnap.xp,
    xpForCurrentLevel: levelSnap.xpForCurrentLevel,
    xpForNextLevel: levelSnap.xpForNextLevel,
    xpProgress: levelSnap.progress,
    nextLevelReward: nextLevelRewardAmount(levelSnap.level),
    claimedLevelRewards: Array.isArray(user.claimedLevelRewards)
      ? user.claimedLevelRewards.map((value) => Math.floor(Number(value) || 0)).filter((value) => value >= 1)
      : [],
    blocked: Boolean(user.blocked),
    blockReason: user.blockReason || null,
    blockedAt: user.blockedAt || null,
    antiAbuseBound: Boolean(user.antiAbuseBound),
  }
}
