import { Route, Routes } from 'react-router-dom'

import { AuthGate } from '@/components/AuthGate'
import { PresenceHeartbeat } from '@/components/PresenceHeartbeat'
import { ServerNotificationToasts } from '@/components/ServerNotificationToasts'
import { useAppSession } from '@/hooks/useAppSession'
import { AppLayout } from '@/layouts/AppLayout'
import { ROUTES } from '@/lib/constants'
import {
  CommunityAccessPage,
  FriendsPage,
  GiveawayDetailPage,
  GiveawaysPage,
  HomePage,
  LeaderboardPage,
  MinesPage,
  TowerPage,
  RollRoute,
  NotFoundPage,
  OperationsHistoryPage,
  OrdersPage,
  ProfilePage,
  ReferralBattlePage,
  ShopPage,
  TasksPage,
} from '@/pages'

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
          <Route path={ROUTES.home} element={<HomePage />} />
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
