import { Route, Routes } from 'react-router-dom'

import { useAppSession } from '@/hooks/useAppSession'
import { AppLayout } from '@/layouts/AppLayout'
import { ROUTES } from '@/lib/constants'
import {
  FriendsPage,
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
    <Routes>
      <Route element={<AppLayout />}>
        <Route path={ROUTES.home} element={<HomePage />} />
        <Route path={ROUTES.tasks} element={<TasksPage />} />
        <Route path={ROUTES.shop} element={<ShopPage />} />
        <Route path={ROUTES.friends} element={<FriendsPage />} />
        <Route path={ROUTES.profile} element={<ProfilePage />} />
        <Route path={ROUTES.operations} element={<OperationsHistoryPage />} />
        <Route path={ROUTES.orders} element={<OrdersPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
