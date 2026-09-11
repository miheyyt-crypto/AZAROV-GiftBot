/** Shared Gram helpers (server). Keep precision at 6 decimal places. */

export const GRAM_CURRENCY = 'GRAM'
export const GRAM_LABEL = 'Gram'
export const MIN_GRAM_WITHDRAWAL = 20
export const GRAM_DECIMALS = 6

export function roundGram(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return 0
  }
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6
}

export function getGramBalance(user) {
  return roundGram(user?.gramBalance || 0)
}

/**
 * Parse user-entered amount. Returns null if invalid.
 * Accepts "20", "20.5", "20,001" (comma as decimal).
 */
export function parseGramAmount(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(',', '.')
  if (!text || !/^\d+(\.\d{1,6})?$/.test(text)) {
    return null
  }
  const value = roundGram(Number(text))
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  return value
}

export function canWithdrawGram(balance, amount = balance) {
  const bal = roundGram(balance)
  const amt = roundGram(amount)
  return bal >= MIN_GRAM_WITHDRAWAL && amt >= MIN_GRAM_WITHDRAWAL && amt <= bal + 1e-12
}

export function formatGramAmount(value) {
  const n = roundGram(value)
  if (!Number.isFinite(n) || n === 0) {
    return '0'
  }
  const fixed = n.toFixed(GRAM_DECIMALS)
  return fixed.replace(/\.?0+$/, '')
}
