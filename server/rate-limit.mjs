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
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}
