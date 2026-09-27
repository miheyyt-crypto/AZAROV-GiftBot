/** Recognizable prize art by imageKey / rewardType — local SVG or PNG. */

import { CASE_CASH_ART_SRC, caseCashArtKind } from "./case-cash-art.js";
import { IconCoin, IconGram } from "./icons.js";
import { FREE_CASE_NFT_ART_SRC } from "./prize-nft-art.js";

type PrizeArtProps = {
  imageKey?: string | null;
  rewardType?: string | null;
  title?: string;
  rarity?: "legendary" | "epic" | "common" | string;
  size?: "sm" | "md" | "lg";
  amount?: string;
};

type Kind =
  | "azc"
  | "gram"
  | "cash"
  | "ring"
  | "watch"
  | "glass"
  | "loot"
  | "generic";

function kindFrom(imageKey?: string | null, rewardType?: string | null, title?: string): Kind {
  const key = `${imageKey ?? ""} ${title ?? ""}`.toLowerCase();
  const type = (rewardType ?? "").toLowerCase();
  if (type === "cash_rub") return "cash";
  if (type === "azc" || key.includes("azc") || key.includes("монет")) return "azc";
  if (type === "gram" || key.includes("gram")) return "gram";
  if (key.includes("ring") || key.includes("кольц")) return "ring";
  if (key.includes("watch") || key.includes("час")) return "watch";
  if (key.includes("glass") || key.includes("durov") || key.includes("яйц")) return "glass";
  if (key.includes("loot") || key.includes("bag") || key.includes("сумк")) return "loot";
  if (type === "external") return "generic";
  return "generic";
}

export function PrizeArt({
  imageKey,
  rewardType,
  title,
  rarity = "common",
  size = "md",
  amount,
}: PrizeArtProps) {
  const kind = kindFrom(imageKey, rewardType, title);
  return (
    <div
      className={`prize-art prize-art--${size} prize-art--${rarity} prize-art--${kind}`}
      aria-hidden="true"
      title={title}
    >
      {kind === "azc" ? <IconCoin size={48} /> : null}
      {kind === "gram" ? <IconGram size={48} /> : null}
      {kind === "cash" ? (
        <PrizePhoto src={CASE_CASH_ART_SRC[caseCashArtKind(amount ?? "0")]} />
      ) : null}
      {kind === "ring" ? <PrizePhoto src={FREE_CASE_NFT_ART_SRC.ring} /> : null}
      {kind === "watch" ? <PrizePhoto src={FREE_CASE_NFT_ART_SRC.watch} /> : null}
      {kind === "glass" ? <PrizePhoto src={FREE_CASE_NFT_ART_SRC.glass} /> : null}
      {kind === "loot" ? <PrizePhoto src={FREE_CASE_NFT_ART_SRC.loot} /> : null}
      {kind === "generic" ? <GenericGlyph /> : null}
    </div>
  );
}

function PrizePhoto({ src }: { src: string }) {
  return <img className="prize-art__img" src={src} alt="" decoding="async" />;
}

function GenericGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="prize-art__svg">
      <path d="M14 28h36l-3 24a6 6 0 0 1-6 5H23a6 6 0 0 1-6-5L14 28Z" fill="#a855f7" />
      <path d="M12 22h40a4 4 0 0 1 4 4v4H8v-4a4 4 0 0 1 4-4Z" fill="#c084fc" />
      <rect x="30" y="22" width="4" height="35" fill="#581c87" />
    </svg>
  );
}
