/**
 * Account bans / multi-account blocking — REMOVED.
 * This module keeps thin compatibility shims so call sites compile.
 * Nobody is blocked; economy always allowed when a user object exists.
 */

export const BLOCK_REASON_MULTI_ACCOUNT = 'MULTI_ACCOUNT'
export const AUDIT_MULTI_ACCOUNT_BLOCK = 'MULTI_ACCOUNT_BLOCK'

/** Always false — ban system deleted. */
export function isMultiAccountCheckEnabled() {
  return false
}

export function ensureAntiAbuseMaps(store) {
  store.pendingBotStarts = store.pendingBotStarts || {}
}

export function getAntiAbuseHmacSecret() {
  return 'anti-abuse-disabled'
}

export function normalizeClientIp(raw) {
  return String(raw || '').trim()
}

export function isUsableClientIp() {
  return true
}

export function hashIp() {
  return null
}

export function maskIp(ip) {
  return String(ip || '')
}

export function parseDeviceId() {
  return null
}

export function hydrateAntiAbuseUserFields(user, { isNew = false } = {}) {
  if (!user) {
    return user
  }
  // Force clear any historical ban state whenever users are touched.
  user.blocked = false
  user.blockReason = null
  user.blockedAt = null
  user.antiAbuseBound = true
  if (user.antiAbuseLegacy == null) {
    user.antiAbuseLegacy = !isNew
  }
  if (user.primaryDeviceId === undefined) {
    user.primaryDeviceId = null
  }
  if (user.primaryIpHash === undefined) {
    user.primaryIpHash = null
  }
  if (user.createdAt == null) {
    user.createdAt = new Date().toISOString()
  }
  return user
}

/** No-op: bans removed. */
export function blockUserMultiAccount(_store, user) {
  if (user) {
    user.blocked = false
    user.blockReason = null
    user.blockedAt = null
    user.antiAbuseBound = true
  }
  return { user }
}

export function peekRegistrationSignals() {
  return {
    ok: true,
    code: null,
    message: null,
    deviceId: null,
    ipHash: null,
    deviceUsed: false,
    ipUsed: false,
  }
}

export function enforceAntiAbuseOnStore(_store, user) {
  hydrateAntiAbuseUserFields(user, { isNew: false })
  return {
    allowed: true,
    code: null,
    message: null,
    deviceUsed: false,
    ipUsed: false,
  }
}

export function userCanEarnRewards(user) {
  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED', message: 'Нужна авторизация.' }
  }
  // Never deny for blocked / unbound — ban system removed.
  return { ok: true, code: null, message: null }
}

export function userCanUseAppEconomy(user) {
  return userCanEarnRewards(user)
}

export function emptyReferralMe() {
  return {
    referralCode: '',
    referralLink: '',
    invitedCount: 0,
    activeCount: 0,
    pendingCount: 0,
    earnedCoins: 0,
    caseProgress: 0,
    caseTarget: 3,
    availableReferralCases: 0,
    earnedReferralCases: 0,
    openedReferralCases: 0,
  }
}

export function buildAdminAntiAbuseView(_store, user) {
  return {
    telegramId: user?.telegramId ?? null,
    username: user?.username || null,
    firstName: user?.firstName || null,
    status: 'ACTIVE',
    blocked: false,
    blockReason: null,
    blockedAt: null,
    antiAbuseBound: true,
    createdAt: user?.createdAt || null,
    device: { idPrefix: null, status: null },
    ip: { hashPrefix: null, status: null, firstSeenAt: null, lastSeenAt: null },
    note: 'Account ban system removed',
  }
}

export const MULTI_ACCOUNT_USER_MESSAGE = {
  title: 'Аккаунт заблокирован',
  message: 'Система блокировок отключена.',
  detail: '',
}

/** Clear every historical account ban + indexes. */
export function unbanAllBlockedUsersOnStore(store) {
  ensureAntiAbuseMaps(store)
  store.deviceIndex = {}
  store.ipHashIndex = {}
  store.antiAbuseAudit = store.antiAbuseAudit || {}
  const unbanned = []

  for (const user of Object.values(store.users || {})) {
    if (!user || typeof user !== 'object') {
      continue
    }
    const wasBlocked = Boolean(user.blocked) || user.blockReason === BLOCK_REASON_MULTI_ACCOUNT
    user.blocked = false
    user.blockReason = null
    user.blockedAt = null
    user.antiAbuseBound = true
    if (wasBlocked) {
      unbanned.push({ telegramId: Number(user.telegramId) || null })
    }
  }

  return {
    unbannedCount: unbanned.length,
    unbanned,
  }
}
