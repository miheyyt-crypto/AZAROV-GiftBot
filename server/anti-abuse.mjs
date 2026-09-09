import crypto from 'node:crypto'
import net from 'node:net'

export const BLOCK_REASON_MULTI_ACCOUNT = 'MULTI_ACCOUNT'
export const AUDIT_MULTI_ACCOUNT_BLOCK = 'MULTI_ACCOUNT_BLOCK'

const DEVICE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function ensureAntiAbuseMaps(store) {
  store.deviceIndex = store.deviceIndex || {}
  store.ipHashIndex = store.ipHashIndex || {}
  store.antiAbuseAudit = store.antiAbuseAudit || {}
  store.pendingBotStarts = store.pendingBotStarts || {}
}

export function getAntiAbuseHmacSecret() {
  const dedicated = String(process.env.ANTI_ABUSE_HMAC_SECRET || '').trim()
  if (dedicated) {
    return dedicated
  }
  const bot = String(process.env.BOT_TOKEN || '').trim()
  if (bot) {
    return `anti-abuse:${bot}`
  }
  return 'anti-abuse-dev-secret'
}

/**
 * Canonical IP for hashing. Maps ::ffff:IPv4 → IPv4, strips zone/brackets,
 * normalizes IPv4 octets and expands IPv6 so string variants collide.
 */
export function normalizeClientIp(raw) {
  let ip = String(raw || '')
    .trim()
    .toLowerCase()
  if (!ip || ip === 'unknown') {
    return ''
  }
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1)
  }
  const zone = ip.indexOf('%')
  if (zone >= 0) {
    ip = ip.slice(0, zone)
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7)
  }

  if (net.isIPv4(ip) || /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.').map((part) => Number(part))
    if (
      parts.length === 4 &&
      parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      return parts.join('.')
    }
    return ''
  }

  if (net.isIPv6(ip) || ip.includes(':')) {
    return expandIPv6(ip)
  }

  return ''
}

function expandIPv6(ip) {
  const raw = String(ip || '')
    .trim()
    .toLowerCase()
  if (!raw.includes(':')) {
    return ''
  }

  let head = raw
  let tail = ''
  if (raw.includes('::')) {
    const parts = raw.split('::')
    if (parts.length !== 2) {
      return raw
    }
    head = parts[0]
    tail = parts[1]
  }

  const headParts = head ? head.split(':').filter(Boolean) : []
  const tailParts = tail ? tail.split(':').filter(Boolean) : []
  const missing = 8 - headParts.length - tailParts.length
  if (missing < 0 || missing > 8) {
    return raw
  }
  const full = [...headParts, ...Array.from({ length: missing }, () => '0'), ...tailParts]
  if (full.length !== 8) {
    return raw
  }
  return full.map((part) => part.replace(/^0+/, '') || '0').join(':')
}

export function isUsableClientIp(raw) {
  return Boolean(normalizeClientIp(raw))
}

export function hashIp(ip, secret = getAntiAbuseHmacSecret()) {
  const normalized = normalizeClientIp(ip)
  if (!normalized) {
    return null
  }
  return crypto.createHmac('sha256', secret).update(normalized).digest('hex')
}

export function maskIp(ip) {
  const normalized = normalizeClientIp(ip)
  if (!normalized) {
    return null
  }
  if (normalized.includes(':')) {
    const parts = normalized.split(':').filter(Boolean)
    if (parts.length < 2) {
      return '***'
    }
    return `${parts[0]}:***:***:${parts[parts.length - 1]}`
  }
  const octets = normalized.split('.')
  if (octets.length !== 4) {
    return '***.***.***.***'
  }
  return `${octets[0]}.***.***.${octets[3]}`
}

export function parseDeviceId(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  if (!DEVICE_ID_RE.test(value)) {
    return null
  }
  return value
}

export function hydrateAntiAbuseUserFields(user, { isNew = false } = {}) {
  if (!user) {
    return user
  }
  if (user.createdAt == null) {
    user.createdAt = new Date().toISOString()
  }
  if (user.blocked == null) {
    user.blocked = false
  }
  if (user.blockReason === undefined) {
    user.blockReason = null
  }
  if (user.blockedAt === undefined) {
    user.blockedAt = null
  }
  if (user.primaryDeviceId === undefined) {
    user.primaryDeviceId = null
  }
  if (user.primaryIpHash === undefined) {
    user.primaryIpHash = null
  }
  if (user.antiAbuseBound == null) {
    user.antiAbuseBound = !isNew
  }
  return user
}

function writeAudit(store, type, meta) {
  ensureAntiAbuseMaps(store)
  const id = `${type}:${meta.telegramId}:${meta.timestamp || Date.now()}:${crypto.randomBytes(4).toString('hex')}`
  store.antiAbuseAudit[id] = {
    id,
    type,
    telegramId: Number(meta.telegramId),
    deviceId: meta.deviceId || null,
    ipHash: meta.ipHash || null,
    reason: meta.reason || BLOCK_REASON_MULTI_ACCOUNT,
    deviceUsed: Boolean(meta.deviceUsed),
    ipUsed: Boolean(meta.ipUsed),
    timestamp: meta.timestamp || new Date().toISOString(),
  }
  return store.antiAbuseAudit[id]
}

export function blockUserMultiAccount(store, user, meta = {}) {
  ensureAntiAbuseMaps(store)
  hydrateAntiAbuseUserFields(user, { isNew: false })
  const now = new Date().toISOString()
  user.blocked = true
  user.blockReason = BLOCK_REASON_MULTI_ACCOUNT
  user.blockedAt = user.blockedAt || now
  user.antiAbuseBound = true

  writeAudit(store, AUDIT_MULTI_ACCOUNT_BLOCK, {
    telegramId: user.telegramId,
    deviceId: meta.deviceId || null,
    ipHash: meta.ipHash || null,
    reason: BLOCK_REASON_MULTI_ACCOUNT,
    deviceUsed: meta.deviceUsed,
    ipUsed: meta.ipUsed,
    timestamp: now,
  })

  console.warn('[anti-abuse] MULTI_ACCOUNT_BLOCK', {
    telegramId: user.telegramId,
    deviceUsed: Boolean(meta.deviceUsed),
    ipUsed: Boolean(meta.ipUsed),
  })

  return { user }
}

/**
 * Pre-create check: does not mutate store. Used so NEW telegram IDs are not
 * persisted before anti-abuse ALLOW (except intentional blocked shells).
 */
export function peekRegistrationSignals(store, { deviceId: rawDeviceId = null, ip = null } = {}) {
  ensureAntiAbuseMaps(store)
  const deviceId = parseDeviceId(rawDeviceId)
  const ipHash = hashIp(ip)

  if (!deviceId) {
    return {
      ok: false,
      code: 'DEVICE_REQUIRED',
      message: 'Не удалось определить устройство. Обновите приложение и попробуйте снова.',
      deviceId: null,
      ipHash: null,
      deviceUsed: false,
      ipUsed: false,
    }
  }

  if (!ipHash || !isUsableClientIp(ip)) {
    return {
      ok: false,
      code: 'IP_REQUIRED',
      message: 'Не удалось проверить сеть. Попробуйте позже.',
      deviceId,
      ipHash: null,
      deviceUsed: false,
      ipUsed: false,
    }
  }

  const deviceUsed = Boolean(store.deviceIndex[deviceId])
  const ipUsed = Boolean(store.ipHashIndex[ipHash])
  if (deviceUsed || ipUsed) {
    return {
      ok: false,
      code: 'MULTI_ACCOUNT_BLOCKED',
      message: 'Аккаунт заблокирован',
      deviceId,
      ipHash,
      deviceUsed,
      ipUsed,
    }
  }

  return {
    ok: true,
    code: null,
    message: null,
    deviceId,
    ipHash,
    deviceUsed: false,
    ipUsed: false,
  }
}

function tryClaimFreeAssociations(store, user, deviceId, ipHash) {
  ensureAntiAbuseMaps(store)
  const now = new Date().toISOString()

  if (deviceId) {
    const existing = store.deviceIndex[deviceId]
    if (!existing) {
      store.deviceIndex[deviceId] = {
        telegramId: Number(user.telegramId),
        createdAt: now,
      }
      if (!user.primaryDeviceId) {
        user.primaryDeviceId = deviceId
      }
    } else if (Number(existing.telegramId) === Number(user.telegramId) && !user.primaryDeviceId) {
      user.primaryDeviceId = deviceId
    }
  }

  if (ipHash) {
    const existing = store.ipHashIndex[ipHash]
    if (!existing) {
      store.ipHashIndex[ipHash] = {
        telegramId: Number(user.telegramId),
        firstSeenAt: now,
        lastSeenAt: now,
      }
      if (!user.primaryIpHash) {
        user.primaryIpHash = ipHash
      }
    } else if (Number(existing.telegramId) === Number(user.telegramId)) {
      existing.lastSeenAt = now
      if (!user.primaryIpHash) {
        user.primaryIpHash = ipHash
      }
    }
  }
}

/**
 * Strict anti-multi-account gate.
 * Existing/grandfathered bound accounts: allow login.
 * Unbound new accounts: require unused deviceId + unused ipHash, else BLOCK.
 */
export function enforceAntiAbuseOnStore(store, user, { deviceId: rawDeviceId = null, ip = null } = {}) {
  ensureAntiAbuseMaps(store)
  hydrateAntiAbuseUserFields(user, { isNew: false })

  if (user.blocked) {
    return {
      allowed: false,
      code: 'MULTI_ACCOUNT_BLOCKED',
      message: 'Аккаунт заблокирован',
      deviceUsed: false,
      ipUsed: false,
    }
  }

  const deviceId = parseDeviceId(rawDeviceId)
  const ipHash = hashIp(ip)
  const now = new Date().toISOString()

  if (user.antiAbuseBound) {
    tryClaimFreeAssociations(store, user, deviceId, ipHash)
    return {
      allowed: true,
      code: null,
      message: null,
      deviceUsed: false,
      ipUsed: false,
    }
  }

  if (!deviceId) {
    return {
      allowed: false,
      code: 'DEVICE_REQUIRED',
      message: 'Не удалось определить устройство. Обновите приложение и попробуйте снова.',
      deviceUsed: false,
      ipUsed: false,
    }
  }

  if (!ipHash || !isUsableClientIp(ip)) {
    return {
      allowed: false,
      code: 'IP_REQUIRED',
      message: 'Не удалось проверить сеть. Попробуйте позже.',
      deviceUsed: false,
      ipUsed: false,
    }
  }

  const deviceRow = store.deviceIndex[deviceId]
  const ipRow = store.ipHashIndex[ipHash]
  const deviceUsed = Boolean(deviceRow && Number(deviceRow.telegramId) !== Number(user.telegramId))
  const ipUsed = Boolean(ipRow && Number(ipRow.telegramId) !== Number(user.telegramId))

  if (deviceUsed || ipUsed) {
    blockUserMultiAccount(store, user, {
      deviceId,
      ipHash,
      deviceUsed,
      ipUsed,
    })
    return {
      allowed: false,
      code: 'MULTI_ACCOUNT_BLOCKED',
      message: 'Аккаунт заблокирован',
      deviceUsed,
      ipUsed,
    }
  }

  store.deviceIndex[deviceId] = {
    telegramId: Number(user.telegramId),
    createdAt: now,
  }
  store.ipHashIndex[ipHash] = {
    telegramId: Number(user.telegramId),
    firstSeenAt: now,
    lastSeenAt: now,
  }
  user.primaryDeviceId = deviceId
  user.primaryIpHash = ipHash
  user.antiAbuseBound = true
  user.createdAt = user.createdAt || now

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
  if (user.blocked) {
    return {
      ok: false,
      code: 'MULTI_ACCOUNT_BLOCKED',
      message: 'Аккаунт заблокирован',
    }
  }
  if (user.antiAbuseBound === false) {
    return {
      ok: false,
      code: 'REGISTRATION_INCOMPLETE',
      message: 'Завершите вход в приложение.',
    }
  }
  return { ok: true }
}

/** Full gate for mutation APIs — same fail-closed rule as rewards. */
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
    caseTarget: 5,
    availableReferralCases: 0,
    earnedReferralCases: 0,
    openedReferralCases: 0,
  }
}

export function buildAdminAntiAbuseView(store, user) {
  if (!user) {
    return null
  }
  ensureAntiAbuseMaps(store)
  hydrateAntiAbuseUserFields(user)

  const deviceId = user.primaryDeviceId || null
  const deviceRow = deviceId ? store.deviceIndex[deviceId] : null
  const ipHash = user.primaryIpHash || null
  const ipRow = ipHash ? store.ipHashIndex[ipHash] : null

  let deviceStatus = null
  if (user.blocked && user.blockReason === BLOCK_REASON_MULTI_ACCOUNT) {
    deviceStatus = deviceRow ? 'bound' : 'already used'
  } else if (deviceRow) {
    deviceStatus =
      Number(deviceRow.telegramId) === Number(user.telegramId) ? 'bound' : 'conflict'
  }

  let ipStatus = null
  if (user.blocked && user.blockReason === BLOCK_REASON_MULTI_ACCOUNT) {
    ipStatus = ipRow ? 'bound' : 'already used'
  } else if (ipRow) {
    ipStatus = Number(ipRow.telegramId) === Number(user.telegramId) ? 'bound' : 'conflict'
  }

  return {
    telegramId: user.telegramId,
    username: user.username || null,
    firstName: user.firstName || null,
    status: user.blocked ? 'BLOCKED' : user.antiAbuseBound ? 'ACTIVE' : 'UNBOUND',
    blocked: Boolean(user.blocked),
    blockReason: user.blockReason || null,
    blockedAt: user.blockedAt || null,
    antiAbuseBound: Boolean(user.antiAbuseBound),
    createdAt: user.createdAt || null,
    device: {
      idPrefix: deviceId ? `${String(deviceId).slice(0, 8)}…` : null,
      status: deviceStatus,
    },
    ip: {
      hashPrefix: ipHash ? `${String(ipHash).slice(0, 12)}…` : null,
      status: ipStatus,
      firstSeenAt: ipRow?.firstSeenAt || null,
      lastSeenAt: ipRow?.lastSeenAt || null,
    },
  }
}

export const MULTI_ACCOUNT_USER_MESSAGE = {
  title: 'Аккаунт заблокирован',
  message:
    'Обнаружена регистрация с устройства или сети, которая уже использовалась другим аккаунтом.',
  detail: 'Если это ошибка, обратитесь в техническую поддержку.',
}
