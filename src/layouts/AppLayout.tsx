import { Outlet, useLocation } from 'react-router-dom'
import { useLayoutEffect } from 'react'

import { BottomNav } from '@/components/BottomNav'
import { resetAppScrollPosition } from '@/lib/telegram'

export function AppLayout() {
  const location = useLocation()

  // #root is a persistent scroll container on desktop. Without resetting on
  // every route change, Home scrollTop carries into Roll and Header sits above
  // the fold (looks "already scrolled" to the wheel). useLayoutEffect = before paint.
  useLayoutEffect(() => {
    resetAppScrollPosition()
  }, [location.pathname])

  return (
    <div className="min-h-full bg-bg-dark text-white">
      <main
        className="mx-auto min-h-full max-w-lg pb-[calc(var(--nav-height,5.75rem)+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))+0.75rem)]"
      >
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
