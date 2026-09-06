import crypto from 'node:crypto'

/** Production Mini App sessions should not stay valid for a full day. */
const MAX_AUTH_AGE_SECONDS = 60 * 60
const MAX_CLOCK_SKEW_SECONDS = 60

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false
  }

  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')

  if (left.length !== right.length) {
    return false
  }

  return crypto.timingSafeEqual(left, right)
}

function normalizeTelegramUser(rawUser) {
  let user
  try {
    user = typeof rawUser === 'string' ? JSON.parse(rawUser) : rawUser
  } catch {
    throw new Error('invalid_user')
  }

  const id = Number(user?.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('invalid_user')
  }

  return {
    id,
    first_name: typeof user.first_name === 'string' ? user.first_name : '',
    last_name: typeof user.last_name === 'string' ? user.last_name : undefined,
    username: typeof user.username === 'string' ? user.username : undefined,
    language_code: typeof user.language_code === 'string' ? user.language_code : undefined,
    photo_url: typeof user.photo_url === 'string' ? user.photo_url : undefined,
    is_premium: Boolean(user.is_premium),
  }
}

export function verifyTelegramInitData(initData, botToken) {
  if (typeof initData !== 'string' || !initData.trim()) {
    throw new Error('missing_init_data')
  }

  if (typeof botToken !== 'string' || !botToken.trim()) {
    throw new Error('missing_bot_token')
  }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')

  if (!hash) {
    throw new Error('missing_hash')
  }

  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  if (!timingSafeEqualHex(computedHash, hash)) {
    throw new Error('invalid_hash')
  }

  const authDate = Number(params.get('auth_date') || 0)
  const now = Math.floor(Date.now() / 1000)

  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error('expired')
  }

  if (authDate > now + MAX_CLOCK_SKEW_SECONDS) {
    throw new Error('expired')
  }

  if (now - authDate > MAX_AUTH_AGE_SECONDS) {
    throw new Error('expired')
  }

  const rawUser = params.get('user')
  if (!rawUser) {
    throw new Error('missing_user')
  }

  const user = normalizeTelegramUser(rawUser)

  return {
    user,
    startParam: params.get('start_param') || '',
  }
}

export function getTelegramUserFromInitData(initData, botToken) {
  return verifyTelegramInitData(initData, botToken).user
}

/**
 * Verify Telegram Login Widget payload (website login).
 * Algorithm differs from Mini App initData:
 *   secret_key = SHA256(bot_token)
 *   hash = HMAC-SHA256(data_check_string, secret_key)
 *
 * Never trust id/username from the client without this check.
 */
export function verifyTelegramLoginWidget(payload, botToken) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('invalid_payload')
  }

  if (typeof botToken !== 'string' || !botToken.trim()) {
    throw new Error('missing_bot_token')
  }

  const hash = String(payload.hash || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error('missing_hash')
  }

  const allowedKeys = new Set([
    'id',
    'first_name',
    'last_name',
    'username',
    'photo_url',
    'auth_date',
  ])

  const checkEntries = []
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'hash') {
      continue
    }
    if (!allowedKeys.has(key)) {
      continue
    }
    if (value === undefined || value === null || value === '') {
      continue
    }
    checkEntries.push([key, String(value)])
  }

  if (checkEntries.length === 0) {
    throw new Error('invalid_payload')
  }

  const dataCheckString = checkEntries
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = crypto.createHash('sha256').update(botToken).digest()
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  if (!timingSafeEqualHex(computedHash, hash)) {
    throw new Error('invalid_hash')
  }

  const authDate = Number(payload.auth_date)
  const now = Math.floor(Date.now() / 1000)

  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error('expired')
  }

  if (authDate > now + MAX_CLOCK_SKEW_SECONDS) {
    throw new Error('expired')
  }

  // Login Widget auth_date window: same 1h policy as Mini App.
  if (now - authDate > MAX_AUTH_AGE_SECONDS) {
    throw new Error('expired')
  }

  const id = Number(payload.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('invalid_user')
  }

  return {
    user: {
      id,
      first_name: typeof payload.first_name === 'string' ? payload.first_name : '',
      last_name: typeof payload.last_name === 'string' ? payload.last_name : undefined,
      username: typeof payload.username === 'string' ? payload.username : undefined,
      photo_url: typeof payload.photo_url === 'string' ? payload.photo_url : undefined,
      language_code: undefined,
      is_premium: false,
    },
    authDate,
  }
}
