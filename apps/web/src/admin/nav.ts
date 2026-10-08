import { parseHash, type AppRoute } from "../app/routes.js";

export const ADMIN_NAV: Array<{
  href: string;
  label: string;
  route: AppRoute["name"];
}> = [
  { href: "#/admin/giveaways", label: "Розыгрыши", route: "admin-giveaways" },
  { href: "#/admin/welvura", label: "Welvura", route: "admin-welvura" },
  { href: "#/admin/shop/orders", label: "Магазин / Заказы", route: "admin-shop-orders" },
  { href: "#/admin/cash-withdrawals", label: "Выводы ₽", route: "admin-cash-withdrawals" },
  { href: "#/admin/gram-withdrawals", label: "Выводы Gram", route: "admin-gram-withdrawals" },
  { href: "#/admin/promo-codes", label: "Промокоды", route: "admin-promo-codes" },
  { href: "#/admin/broadcast", label: "Рассылка", route: "admin-broadcast" },
  { href: "#/admin/donations", label: "Донаты", route: "admin-donations" },
  { href: "#/admin/stream-gifs", label: "Медиа на стрим", route: "admin-stream-gifs" },
];

export function isAdminRouteName(name: AppRoute["name"]): boolean {
  return ADMIN_NAV.some((item) => item.route === name);
}

export function adminRouteFromHref(href: string): AppRoute["name"] | undefined {
  const name = parseHash(href).name;
  return ADMIN_NAV.find((item) => item.route === name)?.route;
}
