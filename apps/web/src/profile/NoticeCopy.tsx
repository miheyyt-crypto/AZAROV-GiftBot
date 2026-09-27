import type { ReactNode } from "react";
import { CoinAmount } from "../components/CoinAmount.js";

const COIN_AZC = /([+\-−]?\d[\d\s]*)\s*AZC\b/gi;

export function NoticeCopy({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  const matches = text.matchAll(COIN_AZC);
  for (const match of matches) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(stripBareAzc(text.slice(cursor, index)));
    }
    const raw = (match[1] ?? "0").replace(/[−]/g, "-").replace(/\s/g, "");
    nodes.push(
      <CoinAmount key={`${raw}-${String(index)}`} amount={raw} sign="auto" size={13} />,
    );
    cursor = index + match[0].length;
  }
  if (cursor < text.length) {
    nodes.push(stripBareAzc(text.slice(cursor)));
  }
  if (nodes.length === 0) {
    return <>{stripBareAzc(text)}</>;
  }
  return <span className="notice-copy">{nodes}</span>;
}

function stripBareAzc(value: string): string {
  return value.replace(/\bAZC\b/gi, "").replace(/[ \t]{2,}/g, " ");
}
