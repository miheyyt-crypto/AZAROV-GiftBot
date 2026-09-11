import { Outlet } from 'react-router-dom'

import { BottomNav } from '@/components/BottomNav'

export function AppLayout() {
  return (
    <div className="min-h-full bg-bg-dark text-white">
      {/*
        max-w-lg keeps Roll/phone column centered on desktop.
        Bottom padding clears fixed BottomNav so bet panel / player list stay clickable.
        On desktop, vertical scroll lives on #root (.app-desktop-embed), not here.
      */}
      <main
        className="mx-auto min-h-full max-w-lg pb-[calc(var(--nav-height,5.75rem)+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))+0.75rem)]"
      >
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
