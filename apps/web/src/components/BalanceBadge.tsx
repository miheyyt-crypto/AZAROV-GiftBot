import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatAzc, groupDigits } from "../lib/format.js";
import { IconCoin } from "../assets/icons.js";

export function BalanceBadge({
  amountAzc,
  amountAzcString,
  icon,
}: {
  amountAzc?: number;
  amountAzcString?: string;
  icon?: ReactNode;
}) {
  const label =
    amountAzcString !== undefined
      ? groupDigits(amountAzcString)
      : formatAzc(amountAzc ?? 0);
  const key = amountAzcString ?? String(amountAzc ?? 0);
  const prev = useRef(key);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (prev.current === key) {
      return;
    }
    prev.current = key;
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 280);
    return () => window.clearTimeout(timer);
  }, [key]);

  return (
    <span className={`balance-badge${pulse ? " balance-badge--pulse" : ""}`}>
      {icon ?? <IconCoin size={14} />}
      <span>{label}</span>
    </span>
  );
}
