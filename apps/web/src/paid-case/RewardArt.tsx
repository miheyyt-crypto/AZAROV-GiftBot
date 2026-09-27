/** Local reward art for paid-case contents — cash photos + coin PNG. */

import { useState } from "react";
import { CASE_CASH_ART_SRC, caseCashArtKind } from "../assets/case-cash-art.js";
import { IconCoin } from "../assets/icons.js";

export function PaidRewardArt({
  rewardType,
  amount,
  rarity,
}: {
  rewardType: "azc" | "cash_rub";
  amount: string;
  rarity: "legendary" | "epic" | "rare" | "common";
}) {
  const cashKind = rewardType === "cash_rub" ? caseCashArtKind(amount) : null;
  return (
    <div
      className={`paid-reward-art paid-reward-art--${rarity} paid-reward-art--${rewardType}${
        cashKind ? ` paid-reward-art--cash-${cashKind}` : ""
      }`}
      aria-hidden="true"
    >
      {rewardType === "cash_rub" ? (
        <CashRubArt amount={amount} />
      ) : (
        <IconCoin className="paid-reward-art__img" size={72} />
      )}
    </div>
  );
}

export function CashRubArt({ amount }: { amount: string }) {
  const kind = caseCashArtKind(amount);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <IconCoin className="paid-reward-art__img" size={72} />;
  }
  return (
    <img
      className="paid-reward-art__img"
      src={CASE_CASH_ART_SRC[kind]}
      alt=""
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
