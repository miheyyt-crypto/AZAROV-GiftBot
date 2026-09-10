/**
 * In-memory Mini App presence for admin online counter.
 * Safe for single-replica Railway deploy (numReplicas = 1).
 */

export const PRESENCE_ONLINE_TTL_MS = 90_000
export const PRESENCE_CLEAN_INTERVAL_MS = 30_000

/** @type {Map<string, { lastSeenAt: number, username?: string|null, firstName?: string|null }>} */
const presenceByUserId = new Map()

let cleanerStarted = false

function startCleaner() {
  if (cleanerStarted) {
    return
  }
  cleanerStarted = true
  setInterval(() => {
    pruneExpiredPresence()
  }, PRESENCE_CLEAN_INTERVAL_MS).unref?.()
}

export function pruneExpiredPresence(nowMs = Date.now(), ttlMs = PRESENCE_ONLINE_TTL_MS) {
  const cutoff = nowMs - ttlMs
  for (const [userId, row] of presenceByUserId.entries()) {
    if (!row || Number(row.lastSeenAt) < cutoff) {
      presenceByUserId.delete(userId)
    }
  }
}

/**
 * Mark a Telegram user as currently active in the Mini App.
 */
export function touchPresence(telegramId, meta = {}, nowMs = Date.now()) {
  const id = String(telegramId ?? '').trim()
  if (!id || !/^\d+$/.test(id)) {
    return { success: false, code: 'INVALID_USER' }
  }

  startCleaner()
  const prev = presenceByUserId.get(id)
  presenceByUserId.set(id, {
    lastSeenAt: nowMs,
    username:
      meta.username != null
        ? String(meta.username).replace(/^@/, '').slice(0, 64) || null
        : prev?.username || null,
    firstName:
      meta.firstName != null
        ? String(meta.firstName).slice(0, 64) || null
        : prev?.firstName || null,
  })

  return {
    success: true,
    onlineCount: getOnlineCount(nowMs),
  }
}

export function getOnlineCount(nowMs = Date.now(), ttlMs = PRESENCE_ONLINE_TTL_MS) {
  pruneExpiredPresence(nowMs, ttlMs)
  return presenceByUserId.size
}

export function listOnlineUsers(nowMs = Date.now(), ttlMs = PRESENCE_ONLINE_TTL_MS) {
  pruneExpiredPresence(nowMs, ttlMs)
  return [...presenceByUserId.entries()]
    .map(([telegramId, row]) => ({
      telegramId: Number(telegramId),
      username: row.username || null,
      firstName: row.firstName || null,
      lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    }))
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
}

/** Test helper */
export function resetPresenceForTests() {
  presenceByUserId.clear()
}
