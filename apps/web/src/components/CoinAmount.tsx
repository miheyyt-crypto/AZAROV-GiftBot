import type { ReactNode } from "react";
import { IconCoin } from "../assets/icons.js";
import { formatRecentWinReward } from "../free-case/messages.js";
import { groupDigits } from "../lib/format.js";

export function CoinAmount({
  amount,
  sign = "none",
  size = 14,
  className,
  icon,
}: {
  amount: string | number;
  sign?: "none" | "plus" | "minus" | "auto";
  size?: number;
  className?: string;
  icon?: ReactNode;
}) {
  const raw = String(amount).trim();
  const negative = raw.startsWith("-");
  const unsigned = (negative ? raw.slice(1) : raw).replace(/^\+/, "");
  let prefix = "";
  if (sign === "minus" || (sign === "auto" && negative)) {
    prefix = "−";
  } else if (
    sign === "plus" ||
    (sign === "auto" && !negative && unsigned !== "0")
  ) {
    prefix = "+";
  }

  return (
    <span className={className ? `coin-amount ${className}` : "coin-amount"}>
      {prefix ? <span className="coin-amount__sign">{prefix}</span> : null}
      {icon ?? <IconCoin size={size} />}
      <span>{groupDigits(unsigned)}</span>
    </span>
  );
}

export function CoinTitle({ title }: { title: string }) {
  const parsed = formatRecentWinReward({ rewardLabel: title, title });
  if (parsed.kind === "azc") {
    return <CoinAmount amount={parsed.label.replace(/\s/g, "")} />;
  }
  return <span>{parsed.label}</span>;
}
