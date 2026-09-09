import { Route, Routes } from 'react-router-dom'

import { AuthGate } from '@/components/AuthGate'
import { ServerNotificationToasts } from '@/components/ServerNotificationToasts'
import { useAppSession } from '@/hooks/useAppSession'
import { AppLayout } from '@/layouts/AppLayout'
import { ROUTES } from '@/lib/constants'
import {
  FriendsPage,
  GiveawaysPage,
  HomePage,
  NotFoundPage,
  OperationsHistoryPage,
  OrdersPage,
  ProfilePage,
  ShopPage,
  TasksPage,
} from '@/pages'

export default function App() {
  useAppSession()

  return (
    <AuthGate>
      <ServerNotificationToasts />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path={ROUTES.home} element={<HomePage />} />
          <Route path={ROUTES.tasks} element={<TasksPage />} />
          <Route path={ROUTES.shop} element={<ShopPage />} />
          <Route path={ROUTES.friends} element={<FriendsPage />} />
          <Route path={ROUTES.profile} element={<ProfilePage />} />
          <Route path={ROUTES.operations} element={<OperationsHistoryPage />} />
          <Route path={ROUTES.orders} element={<OrdersPage />} />
          <Route path={ROUTES.giveaways} element={<GiveawaysPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthGate>
  )
}
