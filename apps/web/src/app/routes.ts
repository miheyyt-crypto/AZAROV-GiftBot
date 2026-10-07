export type AppRoute =
  | { name: "home" }
  | { name: "tasks" }
  | { name: "welvura" }
  | { name: "shop" }
  | { name: "shop-orders" }
  | { name: "friends" }
  | { name: "profile" }
  | { name: "notifications" }
  | { name: "coin-history" }
  | { name: "operations" }
  | { name: "inventory" }
  | { name: "cash-withdrawals" }
  | { name: "achievements" }
  | { name: "giveaways" }
  | { name: "game"; slug: "rolls" | "mines" | "dice" }
  | { name: "leaderboard" }
  | { name: "admin-promo-codes" }
  | { name: "admin-giveaways" }
  | { name: "gram-withdrawals" }
  | { name: "admin-gram-withdrawals" }
  | { name: "admin-shop-orders" }
  | { name: "admin-cash-withdrawals" }
  | { name: "admin-welvura" }
  | { name: "admin-broadcast" }
  | { name: "support" }
  | { name: "admin-donations" };

export type TabId = "home" | "tasks" | "shop" | "friends" | "profile";

export const TABS: { id: TabId; label: string; href: string }[] = [
  { id: "home", label: "Главная", href: "#/" },
  { id: "tasks", label: "Задания", href: "#/tasks" },
  { id: "shop", label: "Магазин", href: "#/shop" },
  { id: "friends", label: "Друзья", href: "#/friends" },
  { id: "profile", label: "Профиль", href: "#/profile" },
];

export function parseHash(hash: string): AppRoute {
  const raw = hash.replace(/^#/, "").split("?")[0] ?? "/";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = path.split("/").filter(Boolean);

  if (parts.length === 0 || (parts[0] === "home" && parts.length === 1)) {
    return { name: "home" };
  }
  if (parts[0] === "tasks" && parts[1] === "welvura") {
    return { name: "welvura" };
  }
  if (parts[0] === "tasks") {
    return { name: "tasks" };
  }
  if (parts[0] === "shop" && parts[1] === "orders") {
    return { name: "shop-orders" };
  }
  if (parts[0] === "shop") {
    return { name: "shop" };
  }
  if (parts[0] === "friends") {
    return { name: "friends" };
  }
  if (parts[0] === "profile" && parts[1] === "notifications") {
    return { name: "notifications" };
  }
  if (parts[0] === "profile" && parts[1] === "history") {
    return { name: "coin-history" };
  }
  if (parts[0] === "profile" && parts[1] === "operations") {
    return { name: "operations" };
  }
  if (parts[0] === "profile" && parts[1] === "inventory" && parts[2] === "withdrawals") {
    return { name: "cash-withdrawals" };
  }
  if (parts[0] === "profile" && parts[1] === "inventory") {
    return { name: "inventory" };
  }
  if (parts[0] === "profile" && parts[1] === "achievements") {
    return { name: "achievements" };
  }
  if (parts[0] === "profile" && parts[1] === "gram") {
    return { name: "gram-withdrawals" };
  }
  if (parts[0] === "profile" && parts[1] === "orders") {
    return { name: "shop-orders" };
  }
  if (parts[0] === "profile") {
    return { name: "profile" };
  }
  if (parts[0] === "support") {
    return { name: "support" };
  }
  if (parts[0] === "giveaways") {
    return { name: "giveaways" };
  }
  if (parts[0] === "games" && (parts[1] === "rolls" || parts[1] === "mines" || parts[1] === "dice")) {
    return { name: "game", slug: parts[1] };
  }
  if (parts[0] === "mines") {
    return { name: "game", slug: "mines" };
  }
  if (parts[0] === "dice") {
    return { name: "game", slug: "dice" };
  }
  if (parts[0] === "admin" && parts[1] === "promo-codes") {
    return { name: "admin-promo-codes" };
  }
  if (parts[0] === "admin" && parts[1] === "giveaways") {
    return { name: "admin-giveaways" };
  }
  if (parts[0] === "admin" && parts[1] === "gram-withdrawals") {
    return { name: "admin-gram-withdrawals" };
  }
  if (parts[0] === "admin" && parts[1] === "shop" && parts[2] === "orders") {
    return { name: "admin-shop-orders" };
  }
  if (parts[0] === "admin" && parts[1] === "cash-withdrawals") {
    return { name: "admin-cash-withdrawals" };
  }
  if (parts[0] === "admin" && parts[1] === "welvura") {
    return { name: "admin-welvura" };
  }
  if (parts[0] === "admin" && parts[1] === "broadcast") {
    return { name: "admin-broadcast" };
  }
  if (parts[0] === "admin" && parts[1] === "donations") {
    return { name: "admin-donations" };
  }
  if (parts[0] === "leaderboard") {
    return { name: "leaderboard" };
  }
  return { name: "home" };
}

export function hrefFor(route: AppRoute): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "support":
      return "#/support";
    case "tasks":
      return "#/tasks";
    case "welvura":
      return "#/tasks/welvura";
    case "shop":
      return "#/shop";
    case "shop-orders":
      return "#/shop/orders";
    case "friends":
      return "#/friends";
    case "profile":
      return "#/profile";
    case "notifications":
      return "#/profile/notifications";
    case "coin-history":
      return "#/profile/history";
    case "operations":
      return "#/profile/operations";
    case "inventory":
      return "#/profile/inventory";
    case "cash-withdrawals":
      return "#/profile/inventory/withdrawals";
    case "achievements":
      return "#/profile/achievements";
    case "giveaways":
      return "#/giveaways";
    case "game":
      return `#/games/${route.slug}`;
    case "leaderboard":
      return "#/leaderboard";
    case "admin-promo-codes":
      return "#/admin/promo-codes";
    case "admin-giveaways":
      return "#/admin/giveaways";
    case "gram-withdrawals":
      return "#/profile/gram";
    case "admin-gram-withdrawals":
      return "#/admin/gram-withdrawals";
    case "admin-shop-orders":
      return "#/admin/shop/orders";
    case "admin-cash-withdrawals":
      return "#/admin/cash-withdrawals";
    case "admin-welvura":
      return "#/admin/welvura";
    case "admin-broadcast":
      return "#/admin/broadcast";
    case "admin-donations":
      return "#/admin/donations";
  }
}

export function tabFor(route: AppRoute): TabId | undefined {
  switch (route.name) {
    case "home":
    case "support":
    case "leaderboard":
    case "giveaways":
    case "game":
      return "home";
    case "tasks":
    case "welvura":
      return "tasks";
    case "shop":
    case "shop-orders":
      return "shop";
    case "friends":
      return "friends";
    case "profile":
    case "notifications":
    case "coin-history":
    case "operations":
    case "inventory":
    case "cash-withdrawals":
    case "achievements":
      return "profile";
    case "gram-withdrawals":
      return "profile";
    case "admin-promo-codes":
    case "admin-giveaways":
    case "admin-gram-withdrawals":
    case "admin-shop-orders":
    case "admin-cash-withdrawals":
    case "admin-welvura":
    case "admin-broadcast":
    case "admin-donations":
      return undefined;
  }
}

export function isMainTab(route: AppRoute): boolean {
  return (
    route.name === "home" ||
    route.name === "tasks" ||
    route.name === "shop" ||
    route.name === "friends" ||
    route.name === "profile"
  );
}

export function isProfileSheet(route: AppRoute): boolean {
  return (
    route.name === "notifications" ||
    route.name === "coin-history" ||
    route.name === "inventory" ||
    route.name === "achievements"
  );
}

/** Floating capsule nav — Home plus nested Home/Tasks screens that keep the chrome. */
export function showsBottomNav(route: AppRoute): boolean {
  return (
    isMainTab(route) ||
    route.name === "support" ||
    route.name === "leaderboard" ||
    route.name === "giveaways" ||
    route.name === "game" ||
    route.name === "shop-orders" ||
    route.name === "cash-withdrawals" ||
    route.name === "operations" ||
    isProfileSheet(route)
  );
}

export function navigate(href: string): void {
  const next = href.startsWith("#") ? href : `#${href}`;
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
