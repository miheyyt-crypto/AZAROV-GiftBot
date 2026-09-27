export const DICE_MIN_BET = 100;
export const DICE_MAX_BET = 10_000;
export const DICE_CHANCE_MIN = 1;
export const DICE_CHANCE_MAX = 95;
export const DICE_QUICK_BETS = [100, 250, 500, 1000, 2500] as const;

export function clampDiceBet(value: number): number {
  return Math.min(DICE_MAX_BET, Math.max(DICE_MIN_BET, Math.floor(value) || DICE_MIN_BET));
}

export function clampDiceChance(value: number): number {
  return Math.min(DICE_CHANCE_MAX, Math.max(DICE_CHANCE_MIN, Math.floor(value) || DICE_CHANCE_MIN));
}

/** Same display as domain `diceMultiplierDisplay` — presentation only. */
export function diceMultiplierPreview(chance: number): string {
  const c = clampDiceChance(chance);
  return (100 / c).toFixed(2);
}

/** Same as domain `dicePayoutAzc` — presentation only. */
export function dicePotentialPayout(bet: number, chance: number): number {
  const c = clampDiceChance(chance);
  const b = Math.floor(bet);
  if (b < DICE_MIN_BET) {
    return 0;
  }
  return Math.floor((b * 100) / c);
}
