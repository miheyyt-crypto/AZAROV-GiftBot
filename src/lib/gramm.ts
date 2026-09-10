export const GRAM_LABEL = 'Gramm'
export const MIN_GRAM_WITHDRAWAL = 20
export const GRAM_DECIMALS = 6

export function roundGram(value: number | string | null | undefined): number {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return 0
  }
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6
}

export function formatGramm(value: number | string | null | undefined): string {
  const n = roundGram(value)
  if (!Number.isFinite(n) || n === 0) {
    return '0'
  }
  const fixed = n.toFixed(GRAM_DECIMALS)
  return fixed.replace(/\.?0+$/, '')
}

export function formatGrammLabel(value: number | string | null | undefined): string {
  return `${formatGramm(value)} ${GRAM_LABEL}`
}

export function canWithdrawGramm(balance: number, amount = balance): boolean {
  const bal = roundGram(balance)
  const amt = roundGram(amount)
  return bal >= MIN_GRAM_WITHDRAWAL && amt >= MIN_GRAM_WITHDRAWAL && amt <= bal + 1e-12
}

export function missingGrammToWithdraw(balance: number): number {
  const bal = roundGram(balance)
  return roundGram(Math.max(0, MIN_GRAM_WITHDRAWAL - bal))
}

export function parseGrammInput(raw: string): number | null {
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
