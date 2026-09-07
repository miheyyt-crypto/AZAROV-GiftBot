import crypto from 'node:crypto'

import {
  getKickRequiredChannel,
  KICK_API_CHANNELS_FOLLOWED_URL,
  KICK_API_CHANNELS_URL,
  KICK_API_EVENTS_SUBSCRIPTIONS_URL,
  KICK_API_LIVESTREAMS_URL,
  KICK_API_PUBLIC_KEY_URL,
  KICK_OAUTH_TOKEN_URL,
} from './constants.mjs'

/** Events the app subscribes to via App Access Token webhooks. */
export const KICK_WEBHOOK_EVENTS = [
  { name: 'channel.followed', version: 1 },
  { name: 'chat.message.sent', version: 1 },
  { name: 'livestream.status.updated', version: 1 },
]

function getKickClientId() {
  return String(process.env.KICK_CLIENT_ID || '').trim()
}

function getKickClientSecret() {
  return String(process.env.KICK_CLIENT_SECRET || '').trim()
}

function isKickOAuthConfigured() {
  return Boolean(getKickClientId() && getKickClientSecret())
}

function logKickApi(event, details = {}) {
  console.info(`[kick-api] ${event}`, details)
}

let cachedAppToken = null
let cachedAppTokenExpiresAt = 0
let cachedPublicKeyPem = null
let cachedChannelBySlug = new Map()

export async function fetchKickAppAccessToken(options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const now = Date.now()
  if (cachedAppToken && cachedAppTokenExpiresAt - 60_000 > now && !options.forceRefresh) {
    return cachedAppToken
  }

  if (!isKickOAuthConfigured()) {
    const error = new Error('kick_not_configured')
    error.code = 'kick_not_configured'
    throw error
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: getKickClientId(),
    client_secret: getKickClientSecret(),
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
    logKickApi('app_token_failed', { status: response.status })
    const error = new Error('kick_app_token_failed')
    error.code = 'kick_app_token_failed'
    throw error
  }

  const expiresIn = Number(payload.expires_in) || 3600
  cachedAppToken = String(payload.access_token)
  cachedAppTokenExpiresAt = now + expiresIn * 1000
  return cachedAppToken
}

export async function refreshKickUserAccessToken(refreshToken, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: getKickClientId(),
    client_secret: getKickClientSecret(),
    refresh_token: String(refreshToken || ''),
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
    const error = new Error('kick_token_expired')
    error.code = 'kick_token_expired'
    throw error
  }

  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : String(refreshToken),
    expiresIn: Number(payload.expires_in) || 0,
    scope: String(payload.scope || ''),
  }
}

/**
 * Resolve Kick channel by slug via official Public API (App Access Token).
 * Falls back to Kick website v2 channel endpoint only if official API is unavailable.
 */
export async function resolveKickChannelBySlug(slug, options = {}) {
  const normalized = String(slug || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
  if (!normalized) {
    const error = new Error('channel_not_configured')
    error.code = 'channel_not_configured'
    throw error
  }

  if (cachedChannelBySlug.has(normalized) && !options.skipCache) {
    return cachedChannelBySlug.get(normalized)
  }

  const fetchImpl = options.fetchImpl || fetch

  try {
    const appToken = options.appAccessToken || (await fetchKickAppAccessToken(options))
    const url = new URL(KICK_API_CHANNELS_URL)
    url.searchParams.set('slug', normalized)

    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${appToken}`,
        Accept: 'application/json',
      },
    })

    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (response.ok) {
      const row = Array.isArray(payload?.data) ? payload.data[0] : null
      if (row?.broadcaster_user_id != null) {
        const channel = {
          slug: String(row.slug || normalized).toLowerCase(),
          broadcasterUserId: String(row.broadcaster_user_id),
          source: 'public_api',
        }
        cachedChannelBySlug.set(normalized, channel)
        return channel
      }
      if (Array.isArray(payload?.data) && payload.data.length === 0) {
        const error = new Error('channel_not_found')
        error.code = 'channel_not_found'
        throw error
      }
    }

    if (response.status === 404) {
      const error = new Error('channel_not_found')
      error.code = 'channel_not_found'
      throw error
    }

    logKickApi('channels_api_fallback', { status: response.status, slug: normalized })
  } catch (error) {
    if (error?.code === 'channel_not_found' || error?.code === 'channel_not_configured') {
      throw error
    }
    logKickApi('channels_api_error', {
      slug: normalized,
      code: error?.code || error?.message || 'unknown',
    })
  }

  // Public website metadata (no secrets). Used only to resolve slug → broadcaster user id.
  const websiteResponse = await fetchImpl(`https://kick.com/api/v2/channels/${encodeURIComponent(normalized)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AZAROV-GiftBot/1.0',
    },
  })

  let websitePayload = null
  try {
    websitePayload = await websiteResponse.json()
  } catch {
    websitePayload = null
  }

  if (!websiteResponse.ok || websitePayload?.user_id == null) {
    const error = new Error(websiteResponse.status === 404 ? 'channel_not_found' : 'kick_api_unavailable')
    error.code = websiteResponse.status === 404 ? 'channel_not_found' : 'kick_api_unavailable'
    throw error
  }

  const channel = {
    slug: String(websitePayload.slug || normalized).toLowerCase(),
    broadcasterUserId: String(websitePayload.user_id),
    channelId: websitePayload.id != null ? String(websitePayload.id) : null,
    source: 'website_v2',
  }
  cachedChannelBySlug.set(normalized, channel)
  return channel
}

function normalizeFollowedRows(payload) {
  if (Array.isArray(payload?.data)) {
    return payload.data
  }
  if (Array.isArray(payload?.channels)) {
    return payload.channels
  }
  if (Array.isArray(payload)) {
    return payload
  }
  return []
}

function rowMatchesChannel(row, channel) {
  const broadcasterId = String(
    row?.broadcaster_user_id ?? row?.broadcasterUserId ?? row?.user_id ?? row?.id ?? '',
  )
  const slug = String(row?.slug ?? row?.channel_slug ?? row?.username ?? row?.user_username ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()

  if (broadcasterId && broadcasterId === String(channel.broadcasterUserId)) {
    return true
  }
  if (slug && slug === String(channel.slug).toLowerCase()) {
    return true
  }
  return false
}

/**
 * Pull-based follow check using Kick Public API.
 * Endpoint is auth-gated (`/public/v1/channels/followed`); not fully documented in Kick swagger,
 * but returns Unauthorized (not 404) when called without a token.
 */
export async function checkKickUserFollowsChannel(accessToken, channel, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }

  const attempts = []

  const filteredUrl = new URL(KICK_API_CHANNELS_FOLLOWED_URL)
  filteredUrl.searchParams.set('broadcaster_user_id', String(channel.broadcasterUserId))
  attempts.push(filteredUrl.toString())
  attempts.push(KICK_API_CHANNELS_FOLLOWED_URL)

  let sawUnauthorized = false
  let sawUnsupported = true
  let lastStatus = 0

  for (const url of attempts) {
    let response
    try {
      response = await fetchImpl(url, { method: 'GET', headers })
    } catch (networkError) {
      const error = new Error('kick_api_unavailable')
      error.code = 'kick_api_unavailable'
      error.cause = networkError
      throw error
    }

    lastStatus = response.status
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (response.status === 401 || response.status === 403) {
      sawUnauthorized = true
      continue
    }

    if (response.status === 404) {
      continue
    }

    if (!response.ok) {
      logKickApi('followed_api_error', { status: response.status })
      const error = new Error('kick_api_unavailable')
      error.code = 'kick_api_unavailable'
      error.httpStatus = response.status
      throw error
    }

    sawUnsupported = false
    const rows = normalizeFollowedRows(payload)
    const following = rows.some((row) => rowMatchesChannel(row, channel))
    return {
      following,
      mode: 'pull',
      matched: following,
      rowCount: rows.length,
    }
  }

  if (sawUnauthorized) {
    const error = new Error('kick_token_expired')
    error.code = 'kick_token_expired'
    throw error
  }

  if (sawUnsupported) {
    logKickApi('followed_api_unsupported', { lastStatus })
    return {
      following: false,
      mode: 'unsupported',
      matched: false,
      lastStatus,
    }
  }

  return {
    following: false,
    mode: 'pull',
    matched: false,
  }
}

export async function listKickEventSubscriptions(options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const appToken = options.appAccessToken || (await fetchKickAppAccessToken(options))
  const url = new URL(KICK_API_EVENTS_SUBSCRIPTIONS_URL)
  if (options.broadcasterUserId != null) {
    url.searchParams.set('broadcaster_user_id', String(options.broadcasterUserId))
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${appToken}`,
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
    logKickApi('event_list_failed', { status: response.status })
    return { ok: false, status: response.status, subscriptions: [] }
  }

  const subscriptions = Array.isArray(payload?.data) ? payload.data : []
  return { ok: true, status: response.status, subscriptions }
}

/**
 * Ensure webhook subscriptions for follow + chat streak + livestream status.
 * Uses App Access Token (no user OAuth re-auth / events:subscribe on user tokens).
 */
export async function ensureKickEventSubscriptions(channel, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const appToken = options.appAccessToken || (await fetchKickAppAccessToken(options))
  const wanted = options.events || KICK_WEBHOOK_EVENTS

  const existing = await listKickEventSubscriptions({
    ...options,
    appAccessToken: appToken,
    broadcasterUserId: channel.broadcasterUserId,
  })

  const present = new Set(
    (existing.subscriptions || [])
      .filter((row) => String(row?.broadcaster_user_id ?? '') === String(channel.broadcasterUserId))
      .map((row) => String(row?.event || row?.name || '')),
  )

  const missing = wanted.filter((event) => !present.has(event.name))
  if (!missing.length) {
    logKickApi('event_subscribe_already', {
      broadcasterUserId: channel.broadcasterUserId,
      slug: channel.slug,
      events: wanted.map((e) => e.name),
    })
    return { ok: true, already: true, data: existing.subscriptions, missing: [] }
  }

  const response = await fetchImpl(KICK_API_EVENTS_SUBSCRIPTIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      broadcaster_user_id: Number(channel.broadcasterUserId),
      events: missing,
      method: 'webhook',
    }),
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    logKickApi('event_subscribe_failed', {
      status: response.status,
      message: typeof payload?.message === 'string' ? payload.message.slice(0, 120) : null,
      missing: missing.map((e) => e.name),
    })
    return { ok: false, status: response.status, message: payload?.message || null, missing }
  }

  logKickApi('event_subscribe_ok', {
    broadcasterUserId: channel.broadcasterUserId,
    slug: channel.slug,
    subscribed: missing.map((e) => e.name),
  })
  return { ok: true, data: payload?.data || null, missing }
}

/** @deprecated Prefer ensureKickEventSubscriptions — kept for call-site compatibility. */
export async function ensureKickFollowEventSubscription(channel, options = {}) {
  return ensureKickEventSubscriptions(channel, {
    ...options,
    events: [{ name: 'channel.followed', version: 1 }],
  })
}

/**
 * Official livestream presence for a broadcaster (aggregate live flag only).
 */
export async function fetchKickChannelLiveStatus(broadcasterUserId, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const appToken = options.appAccessToken || (await fetchKickAppAccessToken(options))
  const url = new URL(KICK_API_LIVESTREAMS_URL)
  url.searchParams.set('broadcaster_user_id', String(broadcasterUserId))

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${appToken}`,
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
    const error = new Error('kick_livestream_unavailable')
    error.code = 'kick_livestream_unavailable'
    error.httpStatus = response.status
    throw error
  }

  const rows = Array.isArray(payload?.data) ? payload.data : []
  const match = rows.find(
    (row) => String(row?.broadcaster_user_id ?? '') === String(broadcasterUserId),
  )
  if (!match) {
    return { isLive: false, startedAt: null, title: null }
  }

  return {
    isLive: true,
    startedAt: match.started_at || null,
    title: match.stream_title || match.title || null,
    viewerCount: match.viewer_count ?? null,
  }
}

export async function getKickWebhookPublicKey(options = {}) {
  if (cachedPublicKeyPem && !options.forceRefresh) {
    return cachedPublicKeyPem
  }

  const fetchImpl = options.fetchImpl || fetch
  const response = await fetchImpl(KICK_API_PUBLIC_KEY_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  const pem = String(payload?.data?.public_key || payload?.public_key || '').trim()
  if (!response.ok || !pem) {
    const error = new Error('kick_public_key_unavailable')
    error.code = 'kick_public_key_unavailable'
    throw error
  }

  cachedPublicKeyPem = pem
  return pem
}

export function verifyKickWebhookSignature({ messageId, timestamp, rawBody, signature, publicKeyPem }) {
  const sigHeader = String(signature || '').trim()
  if (!sigHeader || !messageId || !timestamp || !rawBody || !publicKeyPem) {
    return false
  }

  try {
    const signedPayload = `${messageId}.${timestamp}.${rawBody}`
    const signatureB64 = sigHeader.replace(/^sha256=/i, '')
    const signatureBuf = Buffer.from(signatureB64, 'base64')
    const verifier = crypto.createVerify('RSA-SHA256')
    verifier.update(signedPayload)
    verifier.end()
    return verifier.verify(publicKeyPem, signatureBuf)
  } catch {
    return false
  }
}

export async function bootstrapKickFollowInfrastructure(options = {}) {
  if (!isKickOAuthConfigured()) {
    logKickApi('bootstrap_skipped', { reason: 'kick_not_configured' })
    return { ok: false, reason: 'kick_not_configured' }
  }

  try {
    const slug = getKickRequiredChannel()
    const channel = await resolveKickChannelBySlug(slug, options)
    const sub = await ensureKickEventSubscriptions(channel, options)
    return { ok: Boolean(sub.ok), channel, subscription: sub }
  } catch (error) {
    logKickApi('bootstrap_failed', {
      code: error?.code || error?.message || 'unknown',
    })
    return { ok: false, reason: error?.code || 'bootstrap_failed' }
  }
}

/** Test helpers */
export function _resetKickApiCaches() {
  cachedAppToken = null
  cachedAppTokenExpiresAt = 0
  cachedPublicKeyPem = null
  cachedChannelBySlug = new Map()
}
