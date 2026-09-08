/**
 * Server-side XP / level derived from Kick chat + watch totals.
 * XP = messages + floor(watchSeconds / 60)
 * Each level costs XP_PER_LEVEL (200) — matches profile progress UX.
 */

export const XP_PER_LEVEL = 200

export function computeXpFromStats({ chatMessages = 0, watchSeconds = 0 } = {}) {
  const messages = Math.max(0, Math.floor(Number(chatMessages) || 0))
  const seconds = Math.max(0, Math.floor(Number(watchSeconds) || 0))
  return messages + Math.floor(seconds / 60)
}

export function computeLevelProgress(xpInput) {
  const xp = Math.max(0, Math.floor(Number(xpInput) || 0))
  const level = Math.floor(xp / XP_PER_LEVEL) + 1
  const xpForCurrentLevel = XP_PER_LEVEL * (level - 1)
  const xpForNextLevel = XP_PER_LEVEL * level
  const span = Math.max(1, xpForNextLevel - xpForCurrentLevel)
  const into = Math.min(span, Math.max(0, xp - xpForCurrentLevel))
  const progress = Math.min(100, Math.round((into / span) * 100))

  return {
    level,
    xp,
    xpForCurrentLevel,
    xpForNextLevel,
    progress,
  }
}

export function buildUserLevelSnapshot(user, watchSeconds) {
  const chatMessages = Math.max(0, Math.floor(Number(user?.chatMessages) || 0))
  const seconds = Math.max(
    0,
    Math.floor(Number(watchSeconds ?? user?.watchSeconds ?? 0) || 0),
  )
  const xp = computeXpFromStats({ chatMessages, watchSeconds: seconds })
  const progress = computeLevelProgress(xp)

  // Monotonic peak level (defensive — counters only grow in normal flow).
  const peak = Math.max(Number(user?.peakLevel) || 0, progress.level)
  if (user) {
    user.peakLevel = peak
  }

  return {
    ...progress,
    level: Math.max(progress.level, peak),
    chatMessages,
    watchSeconds: seconds,
    streamHours: Math.floor(seconds / 3600),
  }
}
