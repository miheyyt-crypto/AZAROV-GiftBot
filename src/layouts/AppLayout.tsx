import { Outlet } from 'react-router-dom'

import { BottomNav } from '@/components/BottomNav'

export function AppLayout() {
  return (
    <div className="min-h-full bg-bg-dark text-white">
      <main
        className="mx-auto min-h-full max-w-lg pb-[calc(var(--nav-height)+var(--safe-area-bottom))]"
      >
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
