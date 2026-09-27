import { PrizeArt } from "../assets/PrizeArt.js";
import { PaidRewardArt } from "../paid-case/RewardArt.js";

type ChipRarity = "legendary" | "epic" | "rare" | "common";

function asChipRarity(rarity?: string): ChipRarity {
  if (rarity === "legendary" || rarity === "epic" || rarity === "rare") {
    return rarity;
  }
  return "common";
}

export function CaseChipArt({
  rewardType,
  imageKey,
  title,
  rarity,
  amount,
  size = "sm",
}: {
  rewardType: string;
  imageKey?: string | null;
  title?: string;
  rarity?: string;
  amount?: string;
  size?: "sm" | "md" | "lg";
}) {
  if (rewardType === "cash_rub") {
    return (
      <PaidRewardArt
        rewardType="cash_rub"
        amount={amount ?? "0"}
        rarity={asChipRarity(rarity)}
      />
    );
  }
  return (
    <PrizeArt
      {...(imageKey != null ? { imageKey } : {})}
      rewardType={rewardType}
      {...(title ? { title } : {})}
      rarity={asChipRarity(rarity) === "rare" ? "common" : asChipRarity(rarity)}
      size={size}
    />
  );
}
