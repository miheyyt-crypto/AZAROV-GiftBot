/** Local product/case art — case photos from src/assets/cases, selected shop items as PNG. */

import { CASE_ART_SIZE, CASE_ART_SRC, type ShopCaseCode } from "../assets/cases.js";
import { SHOP_PRODUCT_ART_SRC } from "../assets/shop-product-art.js";

export function shopProductTone(
  code: string,
  category: string,
): "gold" | "pink" | "violet" | "slot" {
  const key = code.toLowerCase();
  if (key === "custom-slot") {
    return "slot";
  }
  if (key.includes("welvura") || category === "money") {
    return "gold";
  }
  if (
    key.includes("donat") ||
    key.includes("gif") ||
    key.includes("music") ||
    key.includes("музык")
  ) {
    return "pink";
  }
  return "violet";
}

export function shopProductCtaTone(
  code: string,
  category: string,
): "gold" | "pink" | "violet" | "slot" {
  if (code.toLowerCase() === "custom-slot") {
    return "pink";
  }
  return shopProductTone(code, category);
}

export function shopProductKind(code: string, title: string): string {
  const key = `${code} ${title}`.toLowerCase();
  if (key.includes("bonus-3000") || key.includes("бонуск")) {
    return "welvura-bonus";
  }
  if (key.includes("custom-slot") || key.includes("свой слот")) {
    return "custom-slot";
  }
  if (key.includes("welvura") && (key.includes("5000") || key.includes("5 000"))) {
    return "welvura-5000";
  }
  if (key.includes("welvura") && key.includes("500")) {
    return "welvura-500";
  }
  if (key.includes("welvura")) {
    return "welvura-200";
  }
  if (key.includes("donat") || key.includes("gif")) {
    return "donation";
  }
  if (key.includes("music") || key.includes("музык") || key.includes("трек")) {
    return "music";
  }
  if (key.includes("freeze") || key.includes("замороз")) {
    return "freeze";
  }
  if (key.includes("premium") && (key.includes("12") || key.includes("год"))) {
    return "premium-12";
  }
  if (key.includes("premium")) {
    return "premium-6";
  }
  if (key.includes("vip") || key.includes("kick")) {
    return "vip";
  }
  return "generic";
}

export function ShopProductArt({
  code,
  title,
}: {
  code: string;
  title: string;
}) {
  const kind = shopProductKind(code, title);
  return (
    <div className={`shop-art shop-art--${kind}`} aria-hidden="true">
      {kind === "welvura-200" ? (
        <ShopPhotoArt src={SHOP_PRODUCT_ART_SRC["welvura-200"]} />
      ) : null}
      {kind === "welvura-500" ? (
        <ShopPhotoArt src={SHOP_PRODUCT_ART_SRC["welvura-500"]} />
      ) : null}
      {kind === "welvura-5000" ? (
        <ShopPhotoArt src={SHOP_PRODUCT_ART_SRC["welvura-5000"]} />
      ) : null}
      {kind === "welvura-bonus" ? (
        <ShopPhotoArt src={SHOP_PRODUCT_ART_SRC["welvura-bonus-3000"]} />
      ) : null}
      {kind === "custom-slot" ? (
        <ShopPhotoArt src={SHOP_PRODUCT_ART_SRC["custom-slot"]} />
      ) : null}
      {kind === "donation" ? <ShopPhotoArt src={SHOP_PRODUCT_ART_SRC.donation} /> : null}
      {kind === "music" ? <ShopPhotoArt src={SHOP_PRODUCT_ART_SRC.music} /> : null}
      {kind === "freeze" ? <ShopPhotoArt src={SHOP_PRODUCT_ART_SRC.freeze} /> : null}
      {kind === "premium-6" ? <PremiumArt variant="green" /> : null}
      {kind === "premium-12" ? <PremiumArt variant="red" /> : null}
      {kind === "vip" ? <ShopPhotoArt src={SHOP_PRODUCT_ART_SRC.vip} /> : null}
      {kind === "generic" ? <BillArt value="₽" tint="#c4b5fd" /> : null}
    </div>
  );
}

export function ShopCaseArt({
  code,
}: {
  code: ShopCaseCode;
}) {
  return (
    <div className={`shop-case-art shop-case-art--${code}`} aria-hidden="true">
      <img
        className="shop-case-art__img"
        src={CASE_ART_SRC[code]}
        alt=""
        width={CASE_ART_SIZE}
        height={CASE_ART_SIZE}
        decoding="async"
        loading="lazy"
      />
    </div>
  );
}

export function ShopCaseHeroArt({
  code,
}: {
  code: ShopCaseCode;
}) {
  return (
    <div className={`paid-case-hero__art paid-case-hero__art--${code}`}>
      <img
        className="paid-case-hero__photo"
        src={CASE_ART_SRC[code]}
        alt=""
        width={CASE_ART_SIZE}
        height={CASE_ART_SIZE}
        decoding="async"
      />
    </div>
  );
}

function BillArt({ value, tint }: { value: string; tint: string }) {
  return (
    <svg viewBox="0 0 120 88" className="shop-art__svg">
      <rect x="10" y="18" width="100" height="54" rx="8" fill={tint} />
      <rect x="16" y="24" width="88" height="42" rx="6" fill="#f8fafc" opacity="0.28" />
      <circle cx="60" cy="45" r="14" fill="#fff" opacity="0.35" />
      <text x="60" y="50" textAnchor="middle" fontSize="13" fontWeight="800" fill="#1f2937">
        {value}
      </text>
    </svg>
  );
}

function ShopPhotoArt({ src }: { src: string }) {
  return (
    <img
      className="shop-art__img"
      src={src}
      alt=""
      decoding="async"
    />
  );
}

export function FreezeArt() {
  return <ShopPhotoArt src={SHOP_PRODUCT_ART_SRC.freeze} />;
}

function PremiumArt({ variant }: { variant: "green" | "red" }) {
  const lid = variant === "green" ? "#4ade80" : "#fb7185";
  const body = variant === "green" ? "#166534" : "#9f1239";
  return (
    <svg viewBox="0 0 120 88" className="shop-art__svg">
      <rect x="30" y="40" width="60" height="34" rx="8" fill={body} />
      <path d="M28 42h64l-8-16H36l-8 16Z" fill={lid} />
      <polygon points="60,16 66,34 54,34" fill="#fbbf24" />
    </svg>
  );
}

