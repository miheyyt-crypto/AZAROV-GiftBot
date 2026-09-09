import crypto from 'node:crypto'

/** Simple in-memory sliding window limiter (single process). */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map()

  function prune(now) {
    for (const [key, entry] of hits) {
      if (now >= entry.resetAt) {
        hits.delete(key)
      }
    }
  }

  return {
    check(key) {
      const now = Date.now()
      if (hits.size > 5_000) {
        prune(now)
      }

      const entry = hits.get(key)
      if (!entry || now >= entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + windowMs })
        return { allowed: true, remaining: max - 1, retryAfterMs: 0 }
      }

      if (entry.count >= max) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(0, entry.resetAt - now),
        }
      }

      entry.count += 1
      return { allowed: true, remaining: max - entry.count, retryAfterMs: 0 }
    },
    reset(key) {
      hits.delete(key)
    },
  }
}

export function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8')
  const right = Buffer.from(String(b || ''), 'utf8')
  if (left.length !== right.length) {
    return false
  }
  if (left.length === 0) {
    return false
  }
  return crypto.timingSafeEqual(left, right)
}

export function clientIp(req) {
  const isProduction = process.env.NODE_ENV === 'production'
  // With trust proxy enabled, Express derives req.ip from the trusted proxy hop.
  // In production never fall back to raw client-controlled XFF/X-Real-IP.
  const expressed = normalizeIpCandidate(req.ip)
  if (expressed) {
    return expressed
  }

  if (isProduction) {
    return normalizeIpCandidate(req.socket?.remoteAddress) || 'unknown'
  }

  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return normalizeIpCandidate(forwarded.split(',')[0]) || 'unknown'
  }

  const realIp = req.headers['x-real-ip']
  if (typeof realIp === 'string' && realIp.trim()) {
    return normalizeIpCandidate(realIp) || 'unknown'
  }

  return normalizeIpCandidate(req.socket?.remoteAddress) || 'unknown'
}

function normalizeIpCandidate(value) {
  let ip = String(value || '')
    .trim()
    .toLowerCase()
  if (!ip) {
    return ''
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7)
  }
  return ip
}

/** Auth / session endpoints — soft IP throttle (single process). */
export const sessionAuthLimiter = createRateLimiter({ windowMs: 60_000, max: 40 })
export const rewardMutationLimiter = createRateLimiter({ windowMs: 60_000, max: 60 })

