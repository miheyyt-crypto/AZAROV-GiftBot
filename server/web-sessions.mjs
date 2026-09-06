import crypto from 'node:crypto'

import { withStore, withStoreRead } from './store.mjs'

export const WEB_SESSION_COOKIE = 'azarov_sid'
export const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function isExpired(session, now = Date.now()) {
  return !session || new Date(session.expiresAt).getTime() <= now
}

export function createWebSessionToken() {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Persist a web session. Only the hash of the token is stored.
 */
export function createWebSession(telegramUserId, meta = {}) {
  const token = createWebSessionToken()
  const tokenHash = hashToken(token)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + WEB_SESSION_TTL_MS).toISOString()

  withStore((store) => {
    store.webSessions = store.webSessions || {}

    // Cap sessions per user to limit abuse / store growth.
    const userId = Number(telegramUserId)
    const existing = Object.entries(store.webSessions).filter(
      ([, session]) => Number(session.telegramUserId) === userId,
    )
    if (existing.length >= 10) {
      existing
        .sort(
          (a, b) =>
            new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime(),
        )
        .slice(0, existing.length - 9)
        .forEach(([key]) => {
          delete store.webSessions[key]
        })
    }

    store.webSessions[tokenHash] = {
      tokenHash,
      telegramUserId: userId,
      createdAt: now.toISOString(),
      expiresAt,
      lastSeenAt: now.toISOString(),
      userAgent: typeof meta.userAgent === 'string' ? meta.userAgent.slice(0, 200) : '',
      ip: typeof meta.ip === 'string' ? meta.ip.slice(0, 64) : '',
    }
  })

  return { token, expiresAt }
}

export function resolveWebSession(token) {
  if (!token || typeof token !== 'string' || token.length < 32 || token.length > 128) {
    return null
  }

  const tokenHash = hashToken(token)

  return withStoreRead((store) => {
    const session = store.webSessions?.[tokenHash]
    if (!session || isExpired(session)) {
      return null
    }

    return {
      telegramUserId: Number(session.telegramUserId),
      expiresAt: session.expiresAt,
    }
  })
}

export function revokeWebSession(token) {
  if (!token || typeof token !== 'string') {
    return false
  }

  const tokenHash = hashToken(token)
  return withStore((store) => {
    store.webSessions = store.webSessions || {}
    if (!store.webSessions[tokenHash]) {
      return false
    }
    delete store.webSessions[tokenHash]
    return true
  })
}

/** Remove expired session rows (call on login / logout). */
export function purgeExpiredWebSessions() {
  return withStore((store) => {
    store.webSessions = store.webSessions || {}
    const now = Date.now()
    let removed = 0
    for (const [key, session] of Object.entries(store.webSessions)) {
      if (isExpired(session, now)) {
        delete store.webSessions[key]
        removed += 1
      }
    }
    return removed
  })
}

export function revokeAllWebSessionsForUser(telegramUserId) {
  return withStore((store) => {
    store.webSessions = store.webSessions || {}
    let removed = 0
    for (const [key, session] of Object.entries(store.webSessions)) {
      if (Number(session.telegramUserId) === Number(telegramUserId)) {
        delete store.webSessions[key]
        removed += 1
      }
    }
    return removed
  })
}

export function parseCookieHeader(header) {
  const cookies = {}
  if (typeof header !== 'string' || !header.trim()) {
    return cookies
  }

  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) {
      continue
    }
    const name = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (!name) {
      continue
    }
    try {
      cookies[name] = decodeURIComponent(value)
    } catch {
      cookies[name] = value
    }
  }

  return cookies
}

export function readWebSessionToken(req) {
  const cookies = parseCookieHeader(req.headers?.cookie)
  return cookies[WEB_SESSION_COOKIE] || ''
}

export function buildWebSessionCookieOptions(expiresAt) {
  const isProduction = process.env.NODE_ENV === 'production'
  const maxAgeMs = Math.max(0, new Date(expiresAt).getTime() - Date.now())

  return {
    httpOnly: true,
    // Same-site app + Vite proxy in dev; production is same-origin HTTPS.
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}

export function serializeSetCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]

  if (options.maxAge != null) {
    parts.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`)
  }
  if (options.path) {
    parts.push(`Path=${options.path}`)
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`)
  }
  if (options.secure) {
    parts.push('Secure')
  }
  if (options.httpOnly) {
    parts.push('HttpOnly')
  }

  return parts.join('; ')
}

export function setWebSessionCookie(res, token, expiresAt) {
  const options = buildWebSessionCookieOptions(expiresAt)
  res.setHeader('Set-Cookie', serializeSetCookie(WEB_SESSION_COOKIE, token, options))
}

export function clearWebSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    serializeSetCookie(WEB_SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    }),
  )
}

/** Best-effort cleanup used by tests / maintenance. */
export function countWebSessions() {
  return withStoreRead((store) => Object.keys(store.webSessions || {}).length)
}
