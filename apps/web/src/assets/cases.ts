export type ShopCaseCode = "poor" | "medium" | "blatnoy" | "referral";

export const CASE_ART_SRC: Record<ShopCaseCode, string> = {
  poor: new URL("./cases/poor-case.webp", import.meta.url).href,
  medium: new URL("./cases/medium-case.webp", import.meta.url).href,
  blatnoy: new URL("./cases/blatnoy-case.webp", import.meta.url).href,
  referral: new URL("./cases/referral-case.webp", import.meta.url).href,
};

export const CASE_ART_SIZE = 704;
