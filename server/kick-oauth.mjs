import crypto from 'node:crypto'

import {
  KICK_API_USERS_URL,
  KICK_CONNECT_TASK_ID,
  KICK_CONNECT_TASK_REWARD,
  KICK_OAUTH_AUTHORIZE_URL,
  KICK_OAUTH_SCOPES,
  KICK_OAUTH_STATE_TTL_MS,
  KICK_OAUTH_TOKEN_URL,
} from './constants.mjs'
import { userCanUseAppEconomy } from './anti-abuse.mjs'
import { activateReferralOnStore } from './referrals.mjs'
import { withStore, withStoreRead } from './store.mjs'
import { addCoins, hasEvent, TX_TYPE } from './wallet.mjs'

function logKick(event, details = {}) {
  console.info(`[kick] ${event}`, details)
}

export function getKickClientId() {
  return String(process.env.KICK_CLIENT_ID || '').trim()
}

export function getKickClientSecret() {
  return String(process.env.KICK_CLIENT_SECRET || '').trim()
}

export function getKickRedirectUri() {
  const fromEnv = String(process.env.KICK_REDIRECT_URI || '').trim()
  if (fromEnv) {
    return fromEnv
  }
  const webapp = String(process.env.WEBAPP_URL || '')
    .trim()
    .replace(/\/$/, '')
  if (!webapp) {
    return ''
  }
  return `${webapp}/api/kick/callback`
}

export function isKickOAuthConfigured() {
  return Boolean(getKickClientId() && getKickClientSecret() && getKickRedirectUri())
}

export function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

export function createOAuthStateId() {
  return crypto.randomBytes(24).toString('base64url')
}

export function buildKickAuthorizeUrl({ clientId, redirectUri, state, codeChallenge, scope }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scope || KICK_OAUTH_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${KICK_OAUTH_AUTHORIZE_URL}?${params.toString()}`
}

export function normalizeKickProfile(rawUser) {
  const kickUserId = String(rawUser?.user_id ?? rawUser?.id ?? '').trim()
  if (!kickUserId || kickUserId === 'undefined' || kickUserId === 'null') {
    return null
  }

  const username = String(rawUser?.username || rawUser?.name || '')
    .trim()
    .replace(/^@/, '')
  const displayName = String(rawUser?.name || rawUser?.username || username || '').trim()
  const avatarUrl = String(rawUser?.profile_picture || rawUser?.profilePicture || '').trim()

  return {
    kickUserId,
    username: username || `user_${kickUserId}`,
    displayName: displayName || username || `user_${kickUserId}`,
    avatarUrl: avatarUrl || '',
  }
}

export function getKickConnectionForUser(store, telegramUserId) {
  const tgKey = String(telegramUserId)
  const user = store.users[tgKey]
  const kickId =
    store.kickByTelegram?.[tgKey] ||
    (user?.kickUserId ? String(user.kickUserId) : '') ||
    ''

  if (!kickId) {
    return {
      connected: false,
    }
  }

  const account = store.kickAccounts?.[kickId]
  return {
    connected: true,
    kickUserId: kickId,
    userId: kickId,
    username: account?.username || user?.kickUsername || '',
    displayName: account?.displayName || user?.kickDisplayName || '',
    avatarUrl: account?.avatarUrl || user?.kickAvatarUrl || '',
    linkedAt: account?.createdAt || user?.kickLinkedAt || null,
  }
}

function maybeCompleteKickConnectTask(store, user) {
  const eventId = `task:${KICK_CONNECT_TASK_ID}:${user.telegramId}`
  if (hasEvent(store, eventId) || user.completedTasks.includes(KICK_CONNECT_TASK_ID)) {
    user.completedTasks = [...new Set([...user.completedTasks, KICK_CONNECT_TASK_ID])]
    return { granted: false }
  }

  const grant = addCoins(store, user, KICK_CONNECT_TASK_REWARD, TX_TYPE.TASK_REWARD, eventId, {
    referenceId: KICK_CONNECT_TASK_ID,
    description: 'Награда за задание: привязка Kick',
  })
  user.completedTasks = [...new Set([...user.completedTasks, KICK_CONNECT_TASK_ID])]
  return { granted: Boolean(grant.granted) }
}

function applyKickTokenBundle(account, tokenBundle) {
  if (!account || !tokenBundle?.accessToken) {
    return
  }
  const expiresIn = Number(tokenBundle.expiresIn) || 0
  account.accessToken = String(tokenBundle.accessToken)
  if (tokenBundle.refreshToken) {
    account.refreshToken = String(tokenBundle.refreshToken)
  }
  account.tokenScope = String(tokenBundle.scope || account.tokenScope || '')
  account.tokenExpiresAt = new Date(Date.now() + Math.max(expiresIn, 60) * 1000).toISOString()
  account.tokenUpdatedAt = new Date().toISOString()
}

function finalizeKickLinkResult(store, telegramUserId, result) {
  if (!result?.ok) {
    return result
  }

  const referralActivation = activateReferralOnStore(store, telegramUserId)
  return {
    ...result,
    referralActivation,
  }
}

/**
 * Atomically link Kick ↔ Telegram with 1:1 uniqueness indexes.
 * Optional tokenBundle stores server-only OAuth tokens for later follow checks.
 * On successful link, confirms any pending referral (Kick-gated rewards).
 */
export function linkKickAccountOnStore(store, telegramUserId, kickProfile, tokenBundle = null) {
  store.kickAccounts = store.kickAccounts || {}
  store.kickByTelegram = store.kickByTelegram || {}

  const user = store.users[String(telegramUserId)]
  if (!user) {
    return {
      ok: false,
      code: 'missing_user',
      message: 'Пользователь не найден.',
    }
  }

  const economy = userCanUseAppEconomy(user)
  if (!economy.ok) {
    return {
      ok: false,
      code: economy.code || 'FORBIDDEN',
      message: economy.message || 'Аккаунт недоступен.',
    }
  }

  const tgKey = String(telegramUserId)
  const kickKey = String(kickProfile.kickUserId)
  const existingKickForTg = store.kickByTelegram[tgKey]
  const existingAccount = store.kickAccounts[kickKey]

  if (existingKickForTg) {
    if (existingKickForTg === kickKey) {
      // Refresh display fields only.
      const account = store.kickAccounts[kickKey]
      if (account) {
        account.username = kickProfile.username
        account.displayName = kickProfile.displayName
        account.avatarUrl = kickProfile.avatarUrl
        account.updatedAt = new Date().toISOString()
        applyKickTokenBundle(account, tokenBundle)
      }
      user.kickVerified = true
      user.kickUserId = kickKey
      user.kickUsername = kickProfile.username
      user.kickDisplayName = kickProfile.displayName
      user.kickAvatarUrl = kickProfile.avatarUrl
      logKick('already_connected', { telegramUserId, kickUserId: kickKey })
      return finalizeKickLinkResult(store, telegramUserId, {
        ok: true,
        code: 'already_connected',
        message: `Kick уже подключён (@${kickProfile.username}).`,
        connection: getKickConnectionForUser(store, telegramUserId),
      })
    }

    logKick('telegram_already_has_kick', {
      telegramUserId,
      existingKickUserId: existingKickForTg,
      attemptedKickUserId: kickKey,
    })
    return {
      ok: false,
      code: 'telegram_already_linked',
      message: `У вас уже подключён Kick аккаунт @${store.kickAccounts[existingKickForTg]?.username || existingKickForTg}.`,
      connection: getKickConnectionForUser(store, telegramUserId),
    }
  }

  if (user.kickUserId && String(user.kickUserId) !== kickKey) {
    return {
      ok: false,
      code: 'telegram_already_linked',
      message: `У вас уже подключён Kick аккаунт @${user.kickUsername || user.kickUserId}.`,
      connection: getKickConnectionForUser(store, telegramUserId),
    }
  }

  if (existingAccount) {
    if (Number(existingAccount.telegramUserId) === Number(telegramUserId)) {
      store.kickByTelegram[tgKey] = kickKey
      user.kickVerified = true
      user.kickUserId = kickKey
      applyKickTokenBundle(existingAccount, tokenBundle)
      return finalizeKickLinkResult(store, telegramUserId, {
        ok: true,
        code: 'already_connected',
        message: `Kick уже подключён (@${existingAccount.username}).`,
        connection: getKickConnectionForUser(store, telegramUserId),
      })
    }

    logKick('kick_already_linked', {
      kickUserId: kickKey,
      ownerTelegramUserId: existingAccount.telegramUserId,
      attemptedTelegramUserId: telegramUserId,
    })
    return {
      ok: false,
      code: 'kick_already_linked',
      message: 'Этот Kick аккаунт уже привязан к другому аккаунту.',
    }
  }

  const now = new Date().toISOString()
  store.kickAccounts[kickKey] = {
    kickUserId: kickKey,
    telegramUserId: Number(telegramUserId),
    username: kickProfile.username,
    displayName: kickProfile.displayName,
    avatarUrl: kickProfile.avatarUrl,
    createdAt: now,
    updatedAt: now,
  }
  applyKickTokenBundle(store.kickAccounts[kickKey], tokenBundle)
  store.kickByTelegram[tgKey] = kickKey

  user.kickVerified = true
  user.kickUserId = kickKey
  user.kickUsername = kickProfile.username
  user.kickDisplayName = kickProfile.displayName
  user.kickAvatarUrl = kickProfile.avatarUrl
  user.kickLinkedAt = now

  const taskGrant = maybeCompleteKickConnectTask(store, user)

  logKick('linked', {
    telegramUserId,
    kickUserId: kickKey,
    taskRewardGranted: taskGrant.granted,
  })

  return finalizeKickLinkResult(store, telegramUserId, {
    ok: true,
    code: 'linked',
    message: `Kick успешно подключён (@${kickProfile.username}).`,
    connection: getKickConnectionForUser(store, telegramUserId),
    taskRewardGranted: taskGrant.granted,
  })
}

export function createKickOAuthStart(telegramUserId) {
  if (!isKickOAuthConfigured()) {
    return {
      success: false,
      code: 'not_configured',
      message: 'Привязка Kick пока недоступна. Настрой KICK_CLIENT_ID / KICK_CLIENT_SECRET / KICK_REDIRECT_URI.',
    }
  }

  return withStore((store) => {
    const user = store.users[String(telegramUserId)]
    const economy = userCanUseAppEconomy(user)
    if (!economy.ok) {
      return {
        success: false,
        code: economy.code || 'FORBIDDEN',
        message: economy.message || 'Аккаунт недоступен для привязки Kick.',
      }
    }

    const connection = getKickConnectionForUser(store, telegramUserId)
    if (connection.connected) {
      return {
        success: false,
        code: 'already_connected',
        message: `Kick уже подключён (@${connection.username}).`,
        connection,
      }
    }

    store.kickOAuthStates = store.kickOAuthStates || {}

    // Prune expired states opportunistically.
    const now = Date.now()
    for (const [key, value] of Object.entries(store.kickOAuthStates)) {
      if (!value?.expiresAt || new Date(value.expiresAt).getTime() <= now || value.usedAt) {
        delete store.kickOAuthStates[key]
      }
    }

    const { codeVerifier, codeChallenge } = generatePkcePair()
    const state = createOAuthStateId()
    const createdAt = new Date()
    const expiresAt = new Date(createdAt.getTime() + KICK_OAUTH_STATE_TTL_MS)

    store.kickOAuthStates[state] = {
      state,
      telegramUserId: Number(telegramUserId),
      codeVerifier,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
    }

    const authorizationUrl = buildKickAuthorizeUrl({
      clientId: getKickClientId(),
      redirectUri: getKickRedirectUri(),
      state,
      codeChallenge,
      scope: KICK_OAUTH_SCOPES,
    })

    logKick('oauth_start', { telegramUserId, statePrefix: state.slice(0, 6) })

    return {
      success: true,
      code: 'started',
      authorizationUrl,
      expiresAt: expiresAt.toISOString(),
    }
  })
}

export function consumeOAuthState(store, state, expectedTelegramUserId = null) {
  store.kickOAuthStates = store.kickOAuthStates || {}
  const raw = String(state || '').trim()
  if (!raw) {
    return { ok: false, code: 'invalid_state', message: 'Сессия авторизации недействительна. Попробуйте ещё раз.' }
  }

  const record = store.kickOAuthStates[raw]
  if (!record) {
    return { ok: false, code: 'invalid_state', message: 'Сессия авторизации недействительна. Попробуйте ещё раз.' }
  }

  if (record.usedAt) {
    return { ok: false, code: 'invalid_state', message: 'Сессия авторизации уже использована. Попробуйте ещё раз.' }
  }

  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    delete store.kickOAuthStates[raw]
    return { ok: false, code: 'expired_state', message: 'Сессия авторизации истекла. Попробуйте ещё раз.' }
  }

  if (
    expectedTelegramUserId != null &&
    Number(record.telegramUserId) !== Number(expectedTelegramUserId)
  ) {
    return { ok: false, code: 'invalid_state', message: 'Сессия авторизации недействительна. Попробуйте ещё раз.' }
  }

  record.usedAt = new Date().toISOString()
  // One-time: remove after consume so it cannot be reused.
  const snapshot = { ...record }
  delete store.kickOAuthStates[raw]
  return { ok: true, state: snapshot }
}

export async function exchangeKickAuthorizationCode(code, codeVerifier, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: getKickClientId(),
    client_secret: getKickClientSecret(),
    redirect_uri: getKickRedirectUri(),
    code_verifier: codeVerifier,
    code: String(code || ''),
  })

  const response = await fetchImpl(KICK_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok || !payload?.access_token) {
    logKick('token_exchange_failed', {
      status: response.status,
      error: typeof payload?.error === 'string' ? payload.error.slice(0, 80) : null,
    })
    const error = new Error('token_exchange_failed')
    error.code = 'token_exchange_failed'
    throw error
  }

  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : '',
    expiresIn: Number(payload.expires_in) || 0,
    scope: String(payload.scope || ''),
  }
}

export async function fetchKickAuthorizedUser(accessToken, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl(KICK_API_USERS_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    logKick('users_api_failed', { status: response.status })
    const error = new Error('kick_api_unavailable')
    error.code = 'kick_api_unavailable'
    throw error
  }

  const rawUser = Array.isArray(payload?.data) ? payload.data[0] : payload?.data || payload
  const profile = normalizeKickProfile(rawUser)
  if (!profile) {
    const error = new Error('kick_user_missing')
    error.code = 'kick_user_missing'
    throw error
  }

  return profile
}

export async function completeKickOAuthCallback({ code, state, error, errorDescription }, options = {}) {
  if (error) {
    logKick('oauth_cancelled', {
      error: String(error).slice(0, 64),
      description: String(errorDescription || '').slice(0, 120),
    })
    return {
      success: false,
      code: error === 'access_denied' ? 'cancelled' : 'oauth_error',
      message:
        error === 'access_denied'
          ? 'Подключение отменено.'
          : 'Не удалось завершить авторизацию Kick.',
    }
  }

  if (!code || !state) {
    return {
      success: false,
      code: 'invalid_callback',
      message: 'Сессия авторизации недействительна. Попробуйте ещё раз.',
    }
  }

  if (!isKickOAuthConfigured()) {
    return {
      success: false,
      code: 'not_configured',
      message: 'Привязка Kick пока недоступна.',
    }
  }

  let consumed
  const consumeResult = withStore((store) => {
    consumed = consumeOAuthState(store, state)
    return consumed
  })

  if (!consumeResult.ok) {
    return {
      success: false,
      code: consumeResult.code,
      message: consumeResult.message,
    }
  }

  const telegramUserId = consumeResult.state.telegramUserId
  const codeVerifier = consumeResult.state.codeVerifier

  let profile
  let tokenBundle = null
  try {
    const token = await exchangeKickAuthorizationCode(code, codeVerifier, options)
    tokenBundle = {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      scope: token.scope,
    }
    profile = await fetchKickAuthorizedUser(token.accessToken, options)
  } catch (err) {
    const codeName = err?.code || err?.message || 'kick_api_unavailable'
    if (codeName === 'token_exchange_failed') {
      return {
        success: false,
        code: 'code_expired',
        message: 'Сессия авторизации истекла. Попробуйте ещё раз.',
      }
    }
    return {
      success: false,
      code: 'kick_api_unavailable',
      message: 'Не удалось связаться с Kick. Попробуйте позже.',
    }
  }

  return withStore((store) => {
    const result = linkKickAccountOnStore(store, telegramUserId, profile, tokenBundle)
    if (!result.ok) {
      return {
        success: false,
        code: result.code,
        message: result.message,
        connection: result.connection || null,
      }
    }

    return {
      success: true,
      code: result.code,
      message: result.message,
      connection: result.connection,
      telegramUserId,
    }
  })
}

export function readKickConnection(telegramUserId) {
  return withStoreRead((store) => getKickConnectionForUser(store, telegramUserId))
}

export function buildKickResultRedirect(status, message = '') {
  const webapp = String(process.env.WEBAPP_URL || '')
    .trim()
    .replace(/\/$/, '')
  const base = webapp || '/'
  const params = new URLSearchParams()
  params.set('kick', status)
  if (message) {
    params.set('kickMessage', message.slice(0, 180))
  }
  // Deep-link back into the profile surface of the Mini App.
  return `${base}/profile?${params.toString()}`
}
