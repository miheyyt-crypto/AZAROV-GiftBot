import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'

import { AuthGate } from '@/components/AuthGate'
import { PresenceHeartbeat } from '@/components/PresenceHeartbeat'
import { ServerNotificationToasts } from '@/components/ServerNotificationToasts'
import { useAppSession } from '@/hooks/useAppSession'
import { AppLayout } from '@/layouts/AppLayout'
import { ROUTES } from '@/lib/constants'
import { Home } from '@/pages/Home'

const LeaderboardPage = lazy(() =>
  import('@/pages/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })),
)
const TasksPage = lazy(() => import('@/pages/Tasks').then((m) => ({ default: m.Tasks })))
const ShopPage = lazy(() => import('@/pages/Shop').then((m) => ({ default: m.Shop })))
const FriendsPage = lazy(() => import('@/pages/Friends').then((m) => ({ default: m.Friends })))
const ProfilePage = lazy(() => import('@/pages/Profile').then((m) => ({ default: m.Profile })))
const OperationsHistoryPage = lazy(() =>
  import('@/pages/OperationsHistoryPage').then((m) => ({ default: m.OperationsHistoryPage })),
)
const OrdersPage = lazy(() =>
  import('@/pages/OrdersPage').then((m) => ({ default: m.OrdersPage })),
)
const GiveawaysPage = lazy(() =>
  import('@/pages/Giveaways').then((m) => ({ default: m.Giveaways })),
)
const GiveawayDetailPage = lazy(() =>
  import('@/pages/GiveawayDetail').then((m) => ({ default: m.GiveawayDetail })),
)
const CommunityAccessPage = lazy(() =>
  import('@/pages/CommunityAccess').then((m) => ({ default: m.CommunityAccess })),
)
const ReferralBattlePage = lazy(() =>
  import('@/pages/ReferralBattlePage').then((m) => ({ default: m.ReferralBattlePage })),
)
const MinesPage = lazy(() =>
  import('@/pages/MinesPage').then((m) => ({ default: m.MinesPage })),
)
const TowerPage = lazy(() =>
  import('@/pages/TowerPage').then((m) => ({ default: m.TowerPage })),
)
const RollRoute = lazy(() =>
  import('@/pages/RollRoute').then((m) => ({ default: m.RollRoute })),
)
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
)

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4 text-sm text-muted">
      Загрузка...
    </div>
  )
}

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
      <Suspense fallback={<RouteFallback />}>
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
      </Suspense>
    </AuthGate>
  )
}
