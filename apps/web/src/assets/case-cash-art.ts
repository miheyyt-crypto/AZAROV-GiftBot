/** Local paid-case cash bill photos (transparent PNG). */
export const CASE_CASH_ART_SRC = {
  high: "/assets/case-cash-high.png",
  "5000": "/assets/case-cash-5000.png",
  other: "/assets/case-cash-other.png",
} as const;

export type CaseCashArtKind = keyof typeof CASE_CASH_ART_SRC;

/** Exact ruble amounts: 10000/20000/30000 → high, 5000 → 5000, else other. */
export function caseCashArtKind(amount: string): CaseCashArtKind {
  const n = amount.replace(/[\s\u00a0]/g, "");
  if (n === "10000" || n === "20000" || n === "30000") {
    return "high";
  }
  if (n === "5000") {
    return "5000";
  }
  return "other";
}
