import { ConflictError } from "./errors.js";
import type { GameSettleInput, GameSettleOutput } from "./game.js";

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readCatalogMinor(value: unknown): bigint | undefined {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  return undefined;
}

export function readAllowedBets(config: unknown): bigint[] | undefined {
  const allowed = asRecord(config)?.allowedBetMinor;
  if (!Array.isArray(allowed)) {
    return undefined;
  }
  const bets: bigint[] = [];
  for (const item of allowed) {
    const amount = readCatalogMinor(item);
    if (amount === undefined || amount <= 0n) {
      throw new ConflictError("game allowedBetMinor is invalid");
    }
    bets.push(amount);
  }
  return bets;
}

export function assertAllowedBet(config: unknown, betAmountMinor: bigint): void {
  const allowed = readAllowedBets(config);
  if (allowed === undefined) {
    throw new ConflictError("game bet amounts are not configured");
  }
  if (!allowed.some((amount) => amount === betAmountMinor)) {
    throw new ConflictError("bet amount is not allowed");
  }
}

export function readCatalogPrizeMinor(config: unknown): bigint {
  const row = asRecord(config);
  if (row === undefined || !("prizeMinor" in row)) {
    return 0n;
  }
  const prize = readCatalogMinor(row.prizeMinor);
  if (prize === undefined || prize < 0n) {
    throw new ConflictError("game prizeMinor is invalid");
  }
  return prize;
}

export function settleFromCatalog(input: GameSettleInput): GameSettleOutput {
  return {
    resultPayload: { draw: input.drawValue.toString() },
    prizeMinor: readCatalogPrizeMinor(input.config),
  };
}
