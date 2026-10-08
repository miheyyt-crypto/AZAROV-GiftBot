import { lazy, Suspense, useEffect } from "react";
import { applyServerBalance } from "../hooks/useAzcBalance.js";
import { isProfileSheet, showsBottomNav, tabFor } from "../app/routes.js";
import type { AppRoute } from "../app/routes.js";
import { useAppRoute } from "../app/useAppRoute.js";
import { AdminActiveRouteProvider } from "../admin/AdminShell.js";
import { isAdminRouteName } from "../admin/nav.js";
import { BottomNavigation } from "../components/BottomNavigation.js";
import type { BootstrapPayload } from "../types.js";
import { Skeleton } from "../ui/Skeleton.js";

const HomePage = lazy(async () => import("../pages/HomePage.js"));
const TasksPage = lazy(async () => import("../pages/TasksPage.js"));
const WelvuraPage = lazy(async () => import("../pages/WelvuraPage.js"));
const ShopPage = lazy(async () => import("../pages/ShopPage.js"));
const OrdersPage = lazy(async () => import("../pages/OrdersPage.js"));
const FriendsPage = lazy(async () => import("../pages/FriendsPage.js"));
const ProfilePage = lazy(async () => import("../pages/ProfilePage.js"));
const NotificationsPage = lazy(async () => import("../pages/NotificationsPage.js"));
const CoinHistoryPage = lazy(async () => import("../pages/CoinHistoryPage.js"));
const InventoryPage = lazy(async () => import("../pages/InventoryPage.js"));
const OperationsHistoryPage = lazy(async () => import("../pages/OperationsHistoryPage.js"));
const CashWithdrawalsPage = lazy(async () => import("../pages/CashWithdrawalsPage.js"));
const AchievementsPage = lazy(async () => import("../pages/AchievementsPage.js"));
const GiveawaysPage = lazy(async () => import("../pages/GiveawaysPage.js"));
const GamePlaceholderPage = lazy(async () => import("../pages/GamePlaceholderPage.js"));
const MinesPage = lazy(async () => import("../pages/MinesPage.js"));
const DicePage = lazy(async () => import("../pages/DicePage.js"));
const RollsPage = lazy(async () => import("../pages/RollsPage.js"));
const LeaderboardPage = lazy(async () => import("../pages/LeaderboardPage.js"));
const AdminPromoPage = lazy(async () => import("../pages/AdminPromoPage.js"));
const AdminGiveawaysPage = lazy(async () => import("../pages/AdminGiveawaysPage.js"));
const GramWithdrawalsPage = lazy(async () => import("../pages/GramWithdrawalsPage.js"));
const AdminGramWithdrawalsPage = lazy(
  async () => import("../pages/AdminGramWithdrawalsPage.js"),
);
const AdminShopOrdersPage = lazy(
  async () => import("../pages/AdminShopOrdersPage.js"),
);
const AdminCashWithdrawalsPage = lazy(
  async () => import("../pages/AdminCashWithdrawalsPage.js"),
);
const AdminWelvuraPage = lazy(async () => import("../pages/AdminWelvuraPage.js"));
const AdminBroadcastPage = lazy(async () => import("../pages/AdminBroadcastPage.js"));
const AdminDonationsPage = lazy(async () => import("../pages/AdminDonationsPage.js"));
const AdminStreamGifsPage = lazy(async () => import("../pages/AdminStreamGifsPage.js"));

function RouteView({
  route,
  token,
  skipRemote,
  isSuperAdmin,
  viewerPublicId,
  bootstrap,
}: {
  route: AppRoute;
  token: string;
  skipRemote: boolean;
  isSuperAdmin: boolean;
  viewerPublicId: string;
  bootstrap: BootstrapPayload;
}) {
  switch (route.name) {
    case "home":
      return (
        <HomePage
          token={token}
          skipRemote={skipRemote}
          viewerPublicId={viewerPublicId}
          bootstrap={bootstrap}
        />
      );
    case "tasks":
      return <TasksPage token={token} skipRemote={skipRemote} />;
    case "welvura":
      return <WelvuraPage token={token} skipRemote={skipRemote} />;
    case "shop":
      return <ShopPage token={token} skipRemote={skipRemote} />;
    case "shop-orders":
      return <OrdersPage token={token} skipRemote={skipRemote} />;
    case "friends":
      return <FriendsPage token={token} skipRemote={skipRemote} />;
    case "profile":
      return (
        <ProfilePage
          token={token}
          skipRemote={skipRemote}
          isSuperAdmin={isSuperAdmin}
        />
      );
    case "notifications":
      return <NotificationsPage token={token} skipRemote={skipRemote} />;
    case "coin-history":
      return <CoinHistoryPage token={token} skipRemote={skipRemote} />;
    case "operations":
      return <OperationsHistoryPage token={token} skipRemote={skipRemote} />;
    case "inventory":
      return <InventoryPage token={token} skipRemote={skipRemote} />;
    case "cash-withdrawals":
      return <CashWithdrawalsPage token={token} skipRemote={skipRemote} />;
    case "achievements":
      return <AchievementsPage token={token} skipRemote={skipRemote} />;
    case "giveaways":
      return (
        <GiveawaysPage
          token={token}
          skipRemote={skipRemote}
          viewerPublicId={viewerPublicId}
        />
      );
    case "game":
      if (route.slug === "mines") {
        return <MinesPage token={token} skipRemote={skipRemote} />;
      }
      if (route.slug === "dice") {
        return <DicePage token={token} skipRemote={skipRemote} />;
      }
      if (route.slug === "rolls") {
        return <RollsPage token={token} skipRemote={skipRemote} />;
      }
      return <GamePlaceholderPage slug={route.slug} />;
    case "leaderboard":
      return <LeaderboardPage token={token} skipRemote={skipRemote} />;
    case "admin-promo-codes":
      return (
        <AdminPromoPage skipRemote={skipRemote} isSuperAdmin={isSuperAdmin} />
      );
    case "admin-giveaways":
      return (
        <AdminGiveawaysPage
          skipRemote={skipRemote}
          isSuperAdmin={isSuperAdmin}
        />
      );
    case "gram-withdrawals":
      return <GramWithdrawalsPage token={token} skipRemote={skipRemote} />;
    case "admin-gram-withdrawals":
      return (
        <AdminGramWithdrawalsPage
          skipRemote={skipRemote}
          isSuperAdmin={isSuperAdmin}
        />
      );
    case "admin-shop-orders":
      return (
        <AdminShopOrdersPage
          skipRemote={skipRemote}
          isSuperAdmin={isSuperAdmin}
        />
      );
    case "admin-cash-withdrawals":
      return (
        <AdminCashWithdrawalsPage
          skipRemote={skipRemote}
          isSuperAdmin={isSuperAdmin}
        />
      );
    case "admin-welvura":
      return (
        <AdminWelvuraPage
          skipRemote={skipRemote}
          isSuperAdmin={isSuperAdmin}
        />
      );
    case "admin-broadcast":
      return (
        <AdminBroadcastPage
          skipRemote={skipRemote}
          isSuperAdmin={isSuperAdmin}
        />
      );
    case "admin-donations":
      return (
        <AdminDonationsPage
          skipRemote={skipRemote}
          isSuperAdmin={isSuperAdmin}
        />
      );
    case "admin-stream-gifs":
      return (
        <AdminStreamGifsPage
          skipRemote={skipRemote}
          isSuperAdmin={isSuperAdmin}
        />
      );
  }
}

export function Shell({
  bootstrap,
  token,
  fixtureSectionError = false,
  fixtureLocalSections = false,
}: {
  bootstrap: BootstrapPayload;
  token: string;
  fixtureSectionError?: boolean;
  fixtureLocalSections?: boolean;
}) {
  const route = useAppRoute();
  const overlayProfile = isProfileSheet(route);
  const tab = overlayProfile ? "profile" : (tabFor(route) ?? "home");
  const showNav = showsBottomNav(route);
  const admin = isAdminRouteName(route.name);

  useEffect(() => {
    applyServerBalance(bootstrap.wallet.balanceMinor);
  }, [bootstrap.wallet.balanceMinor]);

  const shellClass = [
    "shell",
    showNav ? "shell--tabs" : "",
    admin ? "shell--admin" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      {fixtureSectionError ? (
        <section className="card">
          <p>This section could not be loaded.</p>
        </section>
      ) : (
        <Suspense fallback={<Skeleton label="Loading section" />}>
          {overlayProfile ? (
            <ProfilePage
              token={token}
              skipRemote={fixtureLocalSections}
              isSuperAdmin={bootstrap.flags.isSuperAdmin}
            />
          ) : null}
          <AdminActiveRouteProvider routeName={route.name}>
            <RouteView
              route={route}
              token={token}
              skipRemote={fixtureLocalSections}
              isSuperAdmin={bootstrap.flags.isSuperAdmin}
              viewerPublicId={bootstrap.user.publicId}
              bootstrap={bootstrap}
            />
          </AdminActiveRouteProvider>
        </Suspense>
      )}
      {showNav ? <BottomNavigation active={tab} /> : null}
    </div>
  );
}
