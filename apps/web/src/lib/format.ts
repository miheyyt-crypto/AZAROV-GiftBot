export function groupDigits(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = fraction !== undefined && fraction.length > 0 ? `${grouped}.${fraction}` : grouped;
  return negative ? `-${body}` : body;
}

export function formatAzc(amount: number): string {
  return amount.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}

export function formatAzcAmount(amount: string): string {
  return groupDigits(amount);
}

export function formatGramAmount(amount: string): string {
  return `${groupDigits(amount)} Gram`;
}

export function gramProgressPercent(available: string, minimum = "20"): number {
  const availableMinor = decimalToMinor(available, 9);
  const minimumMinor = decimalToMinor(minimum, 9);
  if (minimumMinor <= 0n || availableMinor >= minimumMinor) {
    return 100;
  }
  if (availableMinor <= 0n) {
    return 0;
  }
  return Number((availableMinor * 100n) / minimumMinor);
}

function decimalToMinor(raw: string, scale: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return 0n;
  }
  const [whole = "0", fraction = ""] = raw.split(".");
  const padded = fraction.padEnd(scale, "0").slice(0, scale);
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(padded || "0");
}

export function formatSignedAzcAmount(amount: string): string {
  if (amount === "0") {
    return "0";
  }
  if (amount.startsWith("-")) {
    return `−${groupDigits(amount.slice(1))}`;
  }
  return `+${groupDigits(amount)}`;
}

export function formatRub(amount: number): string {
  return `${amount.toLocaleString("ru-RU").replace(/\u00a0/g, " ")} ₽`;
}

export function formatRubAmount(amount: string): string {
  return `${groupDigits(amount)} ₽`;
}

export function formatShortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short" });
}

export function shortPublicId(id: string): string {
  const compact = id.replace(/-/g, "");
  if (compact.length <= 8) {
    return compact.toUpperCase();
  }
  return compact.slice(-6).toUpperCase();
}

export function ledgerDeltaKind(delta: string): "in" | "out" | "zero" {
  if (delta.startsWith("-")) {
    const rest = delta.slice(1);
    if (rest === "0" || /^0+(\.0+)?$/.test(rest)) {
      return "zero";
    }
    return "out";
  }
  if (delta === "0" || delta === "+0" || /^0+(\.0+)?$/.test(delta)) {
    return "zero";
  }
  return "in";
}
