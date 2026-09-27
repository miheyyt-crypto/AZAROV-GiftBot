export type ShopFieldId =
  | "welvuraId"
  | "telegramUsername"
  | "kickUsername"
  | "streamNickname"
  | "donationText"
  | "mediaUrl";

export type ShopFilter = "all" | "money" | "donations" | "subs" | "other";

export type MockProduct = {
  id: string;
  title: string;
  subtitle?: string;
  priceAzc: number;
  filter: Exclude<ShopFilter, "all">;
  fields: ShopFieldId[];
};

export const MOCK_PRODUCTS: MockProduct[] = [
  {
    id: "welvura-200",
    title: "200 ₽ Welvura",
    priceAzc: 11111,
    filter: "money",
    fields: ["welvuraId"],
  },
  {
    id: "welvura-500",
    title: "500 ₽ Welvura",
    priceAzc: 22222,
    filter: "money",
    fields: ["welvuraId"],
  },
  {
    id: "welvura-5000",
    title: "5 000 ₽ Welvura",
    priceAzc: 199999,
    filter: "money",
    fields: ["welvuraId"],
  },
  {
    id: "donat",
    title: "Донат",
    priceAzc: 1000,
    filter: "donations",
    fields: ["kickUsername", "streamNickname", "donationText"],
  },
  {
    id: "music",
    title: "Музыка",
    priceAzc: 4000,
    filter: "other",
    fields: ["mediaUrl"],
  },
  {
    id: "streak-freeze",
    title: "Streak Freeze",
    priceAzc: 1000,
    filter: "other",
    fields: [],
  },
  {
    id: "vip-kick",
    title: "VIP Kick навсегда",
    priceAzc: 149999,
    filter: "subs",
    fields: ["kickUsername"],
  },
];

export type MockCase = {
  id: string;
  title: string;
  priceAzc?: number;
  priceLabel?: string;
};

export const MOCK_CASES: MockCase[] = [
  { id: "poor", title: "Нищий", priceAzc: 8999 },
  { id: "mid", title: "Средний", priceAzc: 22222 },
  { id: "blat", title: "Блатной", priceAzc: 64999 },
  { id: "ref", title: "Реферальный", priceLabel: "за 5 активных друзей" },
];

export type OrderStatus = "pending" | "processing" | "ready" | "rejected";

export type MockOrder = {
  id: string;
  title: string;
  status: OrderStatus;
  amountAzc: number;
};

export const MOCK_ORDERS: MockOrder[] = [
  { id: "o1", title: "200 ₽ Welvura", status: "pending", amountAzc: 11111 },
  { id: "o2", title: "Донат", status: "processing", amountAzc: 1000 },
  { id: "o3", title: "Streak Freeze", status: "ready", amountAzc: 1000 },
  { id: "o4", title: "Музыка", status: "rejected", amountAzc: 4000 },
];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "В ожидании",
  processing: "В обработке",
  ready: "Готовы",
  rejected: "Отклонены",
};

export const SHOP_FIELD_LABEL: Record<ShopFieldId, string> = {
  welvuraId: "Welvura ID",
  telegramUsername: "Telegram username",
  kickUsername: "Kick username",
  streamNickname: "stream nickname",
  donationText: "donation text max 300",
  mediaUrl: "YouTube/SoundCloud URL",
};
