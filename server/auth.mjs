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
