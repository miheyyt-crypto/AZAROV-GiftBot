export const GRAM_MINOR_SCALE = 9;
export const GRAM_MINOR_PER_UNIT = 1_000_000_000n;
export const GRAM_MIN_WITHDRAWAL_UNITS = 20n;
export const GRAM_MIN_WITHDRAWAL_MINOR =
  GRAM_MIN_WITHDRAWAL_UNITS * GRAM_MINOR_PER_UNIT;

export function formatGramMinor(amountMinor: bigint): string {
  const value = amountMinor < 0n ? 0n : amountMinor;
  const whole = value / GRAM_MINOR_PER_UNIT;
  const fraction = value % GRAM_MINOR_PER_UNIT;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionDigits = fraction
    .toString()
    .padStart(GRAM_MINOR_SCALE, "0")
    .replace(/0+$/, "");
  return `${whole.toString()}.${fractionDigits}`;
}

export function gramAvailableMinor(
  balanceMinor: bigint,
  reservedMinor: bigint,
): bigint {
  return balanceMinor - reservedMinor;
}

export function canWithdrawGram(availableMinor: bigint): boolean {
  return availableMinor >= GRAM_MIN_WITHDRAWAL_MINOR;
}

export function gramWithdrawalProgressPercent(availableMinor: bigint): number {
  if (availableMinor >= GRAM_MIN_WITHDRAWAL_MINOR) {
    return 100;
  }
  if (availableMinor <= 0n) {
    return 0;
  }
  return Number((availableMinor * 100n) / GRAM_MIN_WITHDRAWAL_MINOR);
}

export type GramSummary = {
  balance: string;
  reserved: string;
  available: string;
  minimumWithdrawal: string;
  canWithdraw: boolean;
};

export function serializeGramSummary(
  balanceMinor: bigint,
  reservedMinor: bigint,
): GramSummary {
  const availableMinor = gramAvailableMinor(balanceMinor, reservedMinor);
  return {
    balance: formatGramMinor(balanceMinor),
    reserved: formatGramMinor(reservedMinor),
    available: formatGramMinor(availableMinor),
    minimumWithdrawal: formatGramMinor(GRAM_MIN_WITHDRAWAL_MINOR),
    canWithdraw: canWithdrawGram(availableMinor),
  };
}
