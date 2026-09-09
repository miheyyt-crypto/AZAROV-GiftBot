import crypto from 'node:crypto'
import net from 'node:net'

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

export function normalizeIpCandidate(value) {
  let ip = String(value || '')
    .trim()
    .toLowerCase()
  if (!ip) {
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
  return ip
}

/**
 * Immediate TCP peer that may safely be treated as a reverse proxy hop.
 * Public internet peers are NEVER trusted — otherwise Express `trust proxy: N`
 * + client X-Forwarded-For spoofs req.ip on direct-to-container access.
 *
 * Railway Edge typically connects over private/CGNAT space; loopback covers
 * local health checks and in-process probes.
 */
export function isTrustedProxyHop(raw) {
  const ip = normalizeIpCandidate(raw)
  if (!ip) {
    return false
  }

  if (ip === '::1' || ip.startsWith('127.')) {
    return true
  }

  if (net.isIPv4(ip) || /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.').map((part) => Number(part))
    if (
      parts.length !== 4 ||
      !parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      return false
    }
    const [a, b] = parts
    // RFC1918
    if (a === 10) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    // link-local
    if (a === 169 && b === 254) return true
    // CGNAT / shared (Railway, carrier NAT) 100.64.0.0/10
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }

  if (net.isIPv6(ip) || ip.includes(':')) {
    // ULA fc00::/7, link-local fe80::/10
    if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
      return true
    }
    return false
  }

  return false
}

/**
 * Express trust-proxy callback: only private/loopback peers may forward client IP.
 * Public direct connections keep req.ip === socket.remoteAddress (XFF ignored).
 */
export function trustProxyHop(address) {
  return isTrustedProxyHop(address)
}

/**
 * Canonical client IP for anti-abuse / rate limits.
 * Never reads raw X-Forwarded-For / X-Real-IP / Forwarded in production.
 */
export function clientIp(req) {
  const isProduction = process.env.NODE_ENV === 'production'
  const socketIp = normalizeIpCandidate(req.socket?.remoteAddress)
  const expressed = normalizeIpCandidate(req.ip)

  if (isProduction) {
    if (isTrustedProxyHop(socketIp)) {
      // Peer looks like Railway/mesh proxy — Express req.ip already stripped trusted hops.
      if (expressed) {
        return expressed
      }
      return socketIp || 'unknown'
    }
    // Direct public (or unknown) peer: never trust header-derived Express req.ip.
    return socketIp || 'unknown'
  }

  // Development: prefer Express req.ip, then common proxy headers for local tooling.
  if (expressed) {
    return expressed
  }

  const forwarded = req.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return normalizeIpCandidate(forwarded.split(',')[0]) || 'unknown'
  }

  const realIp = req.headers?.['x-real-ip']
  if (typeof realIp === 'string' && realIp.trim()) {
    return normalizeIpCandidate(realIp) || 'unknown'
  }

  return socketIp || 'unknown'
}

/** Auth / session endpoints — soft IP throttle (single process). */
export const sessionAuthLimiter = createRateLimiter({ windowMs: 60_000, max: 40 })
export const rewardMutationLimiter = createRateLimiter({ windowMs: 60_000, max: 60 })
