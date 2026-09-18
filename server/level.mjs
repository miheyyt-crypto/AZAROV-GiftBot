/**
 * Server-side XP / level derived from Kick chat + watch totals.
 * XP = messages + floor(watchSeconds / 60)
 *
 * Progressive curve: each next level costs more XP.
 *   cost(L) = XP to go from level L → L+1 = 700 + 33*L
 *   L=10 → 1030, L=70 → 3010 (≈1000 / ≈3000 as requested)
 */

export const XP_CURVE_BASE = 700
export const XP_CURVE_PER_LEVEL = 33

/** @deprecated Flat 200 curve removed. Alias of first-level cost for older imports. */
export const XP_PER_LEVEL = XP_CURVE_BASE + XP_CURVE_PER_LEVEL

/** XP required to advance from `fromLevel` to `fromLevel + 1`. */
export function xpRequiredToAdvance(fromLevel) {
  const level = Math.max(1, Math.floor(Number(fromLevel) || 1))
  return XP_CURVE_BASE + XP_CURVE_PER_LEVEL * level
}

/** Total XP required to reach at least `level` (level 1 → 0). */
export function cumulativeXpForLevel(level) {
  const target = Math.max(1, Math.floor(Number(level) || 1))
  if (target <= 1) {
    return 0
  }
  const steps = target - 1
  return XP_CURVE_BASE * steps + Math.floor((XP_CURVE_PER_LEVEL * steps * (steps + 1)) / 2)
}

export function computeXpFromStats({ chatMessages = 0, watchSeconds = 0 } = {}) {
  const messages = Math.max(0, Math.floor(Number(chatMessages) || 0))
  const seconds = Math.max(0, Math.floor(Number(watchSeconds) || 0))
  return messages + Math.floor(seconds / 60)
}

export function computeLevelProgress(xpInput) {
  const xp = Math.max(0, Math.floor(Number(xpInput) || 0))
  let level = 1
  let xpForCurrentLevel = 0

  for (;;) {
    const need = xpRequiredToAdvance(level)
    if (xp < xpForCurrentLevel + need) {
      const xpForNextLevel = xpForCurrentLevel + need
      const span = Math.max(1, need)
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
    xpForCurrentLevel += need
    level += 1
    if (level > 1_000_000) {
      return {
        level,
        xp,
        xpForCurrentLevel,
        xpForNextLevel: xpForCurrentLevel + xpRequiredToAdvance(level),
        progress: 100,
      }
    }
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

  // Track historical peak for analytics / reward seeding, but never inflate
  // the visible level above the XP curve (curve rebalance must apply live).
  if (user) {
    user.peakLevel = Math.max(Number(user.peakLevel) || 0, progress.level)
  }

  return {
    ...progress,
    chatMessages,
    watchSeconds: seconds,
    streamHours: Math.floor(seconds / 3600),
  }
}
