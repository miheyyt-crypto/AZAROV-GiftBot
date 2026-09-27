import { GRAM_MINOR_PER_UNIT, GRAM_MINOR_SCALE, formatGramMinor } from "@giftbot/domain";

export type GramConversion =
  | { ok: true; minor: bigint; canonical: string }
  | { ok: false; reason: string };

function parseDecimalString(raw: string): GramConversion {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, reason: `gram is not a non-negative decimal: ${trimmed}` };
  }
  const [wholePart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > GRAM_MINOR_SCALE) {
    const extra = fracPart.slice(GRAM_MINOR_SCALE);
    if (/[1-9]/.test(extra)) {
      return {
        ok: false,
        reason: `gram has precision beyond scale ${String(GRAM_MINOR_SCALE)}`,
      };
    }
  }
  const frac = fracPart.slice(0, GRAM_MINOR_SCALE).padEnd(GRAM_MINOR_SCALE, "0");
  const minor = BigInt(wholePart ?? "0") * GRAM_MINOR_PER_UNIT + BigInt(frac || "0");
  return { ok: true, minor, canonical: formatGramMinor(minor) };
}

/** Exact decimal → 1e9 minor. Never multiplies IEEE floats. */
export function gramMinorFromUnknown(value: unknown): GramConversion {
  if (value === undefined || value === null) {
    return parseDecimalString("0");
  }
  if (typeof value === "bigint") {
    if (value < 0n) {
      return { ok: false, reason: "negative gram" };
    }
    return parseDecimalString(value.toString());
  }
  if (typeof value === "string") {
    return parseDecimalString(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, reason: "gram number is not a finite non-negative value" };
    }
    return parseDecimalString(String(value));
  }
  return { ok: false, reason: "gram value is not decimal" };
}

export function sumGramMinor(values: bigint[]): bigint {
  return values.reduce((acc, n) => acc + n, 0n);
}
