import { lazy, useEffect, type ComponentType } from 'react'

import { tabPerfFirstRender, tabPerfMounted, wrapLazyImport } from '@/lib/tab-perf'

/** DEBUG: TAB_PERF mount markers — no behavior change when TAB_PERF off. */
export function withTabPerfPage<P extends object>(
  page: string,
  Component: ComponentType<P>,
): ComponentType<P> {
  function TabPerfWrapped(props: P) {
    tabPerfFirstRender(page)
    useEffect(() => {
      tabPerfMounted(page)
    }, [])
    return <Component {...props} />
  }
  TabPerfWrapped.displayName = `TabPerf(${page})`
  return TabPerfWrapped
}

/** Shared dynamic import — used by React.lazy and idle prefetch. */
export function loadLeaderboardPage() {
  return import('@/pages/LeaderboardPage')
}

export function loadTasksPage() {
  return import('@/pages/Tasks')
}

export function loadFriendsPage() {
  return import('@/pages/Friends')
}

export function loadProfilePage() {
  return import('@/pages/Profile')
}

export const LeaderboardPage = lazy(
  wrapLazyImport('LeaderboardPage', () =>
    loadLeaderboardPage().then((m) => ({ default: m.LeaderboardPage })),
  ),
)

export const TasksPage = lazy(
  wrapLazyImport('Tasks', () =>
    loadTasksPage().then((m) => ({
      default: withTabPerfPage('tasks', m.Tasks),
    })),
  ),
)

export const FriendsPage = lazy(
  wrapLazyImport('Friends', () =>
    loadFriendsPage().then((m) => ({
      default: withTabPerfPage('friends', m.Friends),
    })),
  ),
)

export const ProfilePage = lazy(
  wrapLazyImport('Profile', () =>
    loadProfilePage().then((m) => ({
      default: withTabPerfPage('profile', m.Profile),
    })),
  ),
)

/** Fallback for page-area Suspense only (layout / BottomNav stay mounted). */
export function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4 text-sm text-muted">
      Загрузка...
    </div>
  )
}
