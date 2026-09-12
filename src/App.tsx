import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'

import { AuthGate } from '@/components/AuthGate'
import { PresenceHeartbeat } from '@/components/PresenceHeartbeat'
import { ServerNotificationToasts } from '@/components/ServerNotificationToasts'
import { useAppSession } from '@/hooks/useAppSession'
import { AppLayout } from '@/layouts/AppLayout'
import { ROUTES } from '@/lib/constants'
import {
  FriendsPage,
  LeaderboardPage,
  ProfilePage,
  TasksPage,
  withTabPerfPage,
} from '@/lib/lazy-routes'
import { wrapLazyImport } from '@/lib/tab-perf'
import { Home } from '@/pages/Home'
import { Shop } from '@/pages/Shop'

/** Eager Shop: avoid cold Suspense on first Magazin tap. Cases stay lazy inside Shop. */
const ShopPage = withTabPerfPage('shop', Shop)

const OperationsHistoryPage = lazy(
  wrapLazyImport('OperationsHistoryPage', () =>
    import('@/pages/OperationsHistoryPage').then((m) => ({
      default: m.OperationsHistoryPage,
    })),
  ),
)
const OrdersPage = lazy(
  wrapLazyImport('OrdersPage', () =>
    import('@/pages/OrdersPage').then((m) => ({ default: m.OrdersPage })),
  ),
)
const GiveawaysPage = lazy(
  wrapLazyImport('Giveaways', () =>
    import('@/pages/Giveaways').then((m) => ({ default: m.Giveaways })),
  ),
)
const GiveawayDetailPage = lazy(
  wrapLazyImport('GiveawayDetail', () =>
    import('@/pages/GiveawayDetail').then((m) => ({ default: m.GiveawayDetail })),
  ),
)
const CommunityAccessPage = lazy(
  wrapLazyImport('CommunityAccess', () =>
    import('@/pages/CommunityAccess').then((m) => ({ default: m.CommunityAccess })),
  ),
)
const ReferralBattlePage = lazy(
  wrapLazyImport('ReferralBattlePage', () =>
    import('@/pages/ReferralBattlePage').then((m) => ({
      default: m.ReferralBattlePage,
    })),
  ),
)
const MinesPage = lazy(
  wrapLazyImport('MinesPage', () =>
    import('@/pages/MinesPage').then((m) => ({ default: m.MinesPage })),
  ),
)
const TowerPage = lazy(
  wrapLazyImport('TowerPage', () =>
    import('@/pages/TowerPage').then((m) => ({ default: m.TowerPage })),
  ),
)
const RollRoute = lazy(
  wrapLazyImport('RollRoute', () =>
    import('@/pages/RollRoute').then((m) => ({ default: m.RollRoute })),
  ),
)
const NotFoundPage = lazy(
  wrapLazyImport('NotFoundPage', () =>
    import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
  ),
)

/** Runs only under AuthGate so auth-dependent hooks have a provider. */
function AuthenticatedSessionEffects() {
  useAppSession()
  return null
}

export default function App() {
  return (
    <AuthGate>
      <AuthenticatedSessionEffects />
      <PresenceHeartbeat />
      <ServerNotificationToasts />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path={ROUTES.home} element={<Home />} />
          <Route path={ROUTES.leaderboard} element={<LeaderboardPage />} />
          <Route path={ROUTES.tasks} element={<TasksPage />} />
          <Route path={ROUTES.shop} element={<ShopPage />} />
          <Route path={ROUTES.friends} element={<FriendsPage />} />
          <Route path={ROUTES.profile} element={<ProfilePage />} />
          <Route path={ROUTES.operations} element={<OperationsHistoryPage />} />
          <Route path={ROUTES.orders} element={<OrdersPage />} />
          <Route path={ROUTES.giveaways} element={<GiveawaysPage />} />
          <Route path={`${ROUTES.giveaways}/:giveawayId`} element={<GiveawayDetailPage />} />
          <Route path={ROUTES.communityAccess} element={<CommunityAccessPage />} />
          <Route path={ROUTES.referralBattle} element={<ReferralBattlePage />} />
          <Route path={ROUTES.mines} element={<MinesPage />} />
          <Route path={ROUTES.tower} element={<TowerPage />} />
          <Route path={ROUTES.roll} element={<RollRoute />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthGate>
  )
}
