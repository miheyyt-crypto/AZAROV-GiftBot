/**
 * Kick channel stats: chat message counts + watch-time heartbeats.
 * Does not own streak logic — call from kick-streak after live/link gates.
 */

const DEFAULT_ACTIVITY_WINDOW_MINUTES = 10

export function getWatchActivityWindowMs() {
  const raw = Number(process.env.KICK_WATCH_ACTIVITY_WINDOW)
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ACTIVITY_WINDOW_MINUTES
  return Math.floor(minutes * 60 * 1000)
}

export function ensureKickWatchStats(store) {
  store.kickWatchStats = store.kickWatchStats || {}
}

export function emptyWatchStats() {
  return {
    totalWatchSeconds: 0,
    currentSessionStartedAt: null,
    lastSeenAt: null,
    lastStreamId: null,
  }
}

export function getKickWatchStatsRecord(store, telegramId) {
  ensureKickWatchStats(store)
  const key = String(telegramId)
  if (!store.kickWatchStats[key]) {
    store.kickWatchStats[key] = emptyWatchStats()
  }
  const record = store.kickWatchStats[key]
  record.totalWatchSeconds = Math.max(0, Math.floor(Number(record.totalWatchSeconds) || 0))
  return record
}

export function syncUserWatchCounters(user, totalWatchSeconds) {
  if (!user) {
    return
  }
  const seconds = Math.max(0, Math.floor(Number(totalWatchSeconds) || 0))
  user.watchSeconds = seconds
  user.streamHours = Math.floor(seconds / 3600)
}

export function recordChatMessageOnStore(store, telegramId) {
  const user = store.users?.[String(telegramId)]
  if (!user) {
    return { ok: false, reason: 'user_missing' }
  }
  user.chatMessages = Math.max(0, Math.floor(Number(user.chatMessages) || 0)) + 1
  return { ok: true, chatMessages: user.chatMessages }
}

function resolveStreamId(streamId, store) {
  if (streamId != null && String(streamId).trim()) {
    return String(streamId).trim()
  }
  const startedAt = store?.kickLivestreamState?.startedAt
  if (startedAt) {
    return `started:${startedAt}`
  }
  return null
}

/**
 * Heartbeat while the viewer is active on a confirmed live stream.
 * Credits at most the activity window between heartbeats; never credits long gaps.
 */
export function applyWatchActivityOnStore(
  store,
  telegramId,
  { atIso, streamId = null, isLiveConfirmed = false } = {},
) {
  if (!isLiveConfirmed) {
    return { addedSeconds: 0, reason: 'not_live' }
  }

  const user = store.users?.[String(telegramId)]
  if (!user) {
    return { addedSeconds: 0, reason: 'user_missing' }
  }

  const atMs = Date.parse(String(atIso || ''))
  if (!Number.isFinite(atMs)) {
    return { addedSeconds: 0, reason: 'bad_timestamp' }
  }

  const stats = getKickWatchStatsRecord(store, telegramId)
  const windowMs = getWatchActivityWindowMs()
  const maxAdd = Math.floor(windowMs / 1000)
  const nextStreamId = resolveStreamId(streamId, store)

  // Stream change closes previous session (already credited up to lastSeenAt).
  if (
    stats.lastStreamId &&
    nextStreamId &&
    stats.lastStreamId !== nextStreamId &&
    stats.lastSeenAt
  ) {
    stats.currentSessionStartedAt = new Date(atMs).toISOString()
    stats.lastSeenAt = new Date(atMs).toISOString()
    stats.lastStreamId = nextStreamId
    syncUserWatchCounters(user, stats.totalWatchSeconds)
    return { addedSeconds: 0, reason: 'stream_changed' }
  }

  if (!stats.lastSeenAt) {
    stats.currentSessionStartedAt = new Date(atMs).toISOString()
    stats.lastSeenAt = new Date(atMs).toISOString()
    stats.lastStreamId = nextStreamId
    syncUserWatchCounters(user, stats.totalWatchSeconds)
    return { addedSeconds: 0, reason: 'session_started' }
  }

  const lastMs = Date.parse(stats.lastSeenAt)
  if (!Number.isFinite(lastMs)) {
    stats.lastSeenAt = new Date(atMs).toISOString()
    stats.currentSessionStartedAt = stats.currentSessionStartedAt || stats.lastSeenAt
    stats.lastStreamId = nextStreamId || stats.lastStreamId
    syncUserWatchCounters(user, stats.totalWatchSeconds)
    return { addedSeconds: 0, reason: 'bad_last_seen' }
  }

  const deltaMs = atMs - lastMs
  let addedSeconds = 0
  let reason = 'heartbeat'

  if (deltaMs < 0) {
    // Clock skew — move cursor forward, never subtract.
    reason = 'clock_skew'
  } else if (deltaMs <= windowMs) {
    addedSeconds = Math.min(maxAdd, Math.floor(deltaMs / 1000))
    stats.totalWatchSeconds = Math.max(0, stats.totalWatchSeconds + addedSeconds)
  } else {
    // Gap larger than activity window — start a new session, credit nothing for the gap.
    stats.currentSessionStartedAt = new Date(atMs).toISOString()
    reason = 'session_restart'
  }

  stats.lastSeenAt = new Date(atMs).toISOString()
  if (!stats.currentSessionStartedAt) {
    stats.currentSessionStartedAt = stats.lastSeenAt
  }
  if (nextStreamId) {
    stats.lastStreamId = nextStreamId
  }

  syncUserWatchCounters(user, stats.totalWatchSeconds)
  return { addedSeconds, reason, totalWatchSeconds: stats.totalWatchSeconds }
}

/**
 * Close open watch sessions when the required channel goes offline.
 * Does not invent extra watch time past lastSeenAt.
 */
export function closeWatchSessionsOnStore(store, { streamId = null, endedAtIso = null } = {}) {
  ensureKickWatchStats(store)
  const endedIso = endedAtIso || new Date().toISOString()
  let closed = 0

  for (const [key, stats] of Object.entries(store.kickWatchStats || {})) {
    if (!stats) {
      continue
    }
    if (streamId && stats.lastStreamId && String(stats.lastStreamId) !== String(streamId)) {
      continue
    }
    if (!stats.currentSessionStartedAt && !stats.lastSeenAt) {
      continue
    }

    // Optional tiny credit if stream ended shortly after last activity within window —
    // still capped; never beyond endedAt and never beyond window from lastSeen.
    if (stats.lastSeenAt && endedIso) {
      const lastMs = Date.parse(stats.lastSeenAt)
      const endMs = Date.parse(endedIso)
      if (Number.isFinite(lastMs) && Number.isFinite(endMs) && endMs > lastMs) {
        const windowMs = getWatchActivityWindowMs()
        const deltaMs = Math.min(endMs - lastMs, windowMs)
        // Only credit trailing seconds if session was still "open".
        if (stats.currentSessionStartedAt && deltaMs > 0 && deltaMs <= windowMs) {
          const add = Math.floor(deltaMs / 1000)
          stats.totalWatchSeconds = Math.max(0, (stats.totalWatchSeconds || 0) + add)
          stats.lastSeenAt = new Date(lastMs + deltaMs).toISOString()
        }
      }
    }

    stats.currentSessionStartedAt = null
    const user = store.users?.[key]
    if (user) {
      syncUserWatchCounters(user, stats.totalWatchSeconds || 0)
    }
    closed += 1
  }

  return { closed }
}

export function getUserKickStatsSnapshot(user, store = null, telegramId = null) {
  const watchFromStore =
    store && telegramId != null
      ? store.kickWatchStats?.[String(telegramId)]?.totalWatchSeconds
      : null
  const watchSeconds = Math.max(
    0,
    Math.floor(Number(watchFromStore ?? user?.watchSeconds ?? 0) || 0),
  )
  const chatMessages = Math.max(0, Math.floor(Number(user?.chatMessages) || 0))
  const streamHours = Math.floor(watchSeconds / 3600)
  return { chatMessages, watchSeconds, streamHours }
}
