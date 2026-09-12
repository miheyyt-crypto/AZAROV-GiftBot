import {
  loadFriendsPage,
  loadLeaderboardPage,
  loadProfilePage,
  loadTasksPage,
} from '@/lib/lazy-routes'
import { tabPerfMark } from '@/lib/tab-perf'

type IdleHandle = number

let prefetchSessionStarted = false

function scheduleIdle(fn: () => void, timeoutMs: number): IdleHandle {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(() => fn(), { timeout: timeoutMs }) as IdleHandle
  }
  return window.setTimeout(fn, Math.min(400, timeoutMs)) as IdleHandle
}

/**
 * After Home is interactive: prefetch main-tab JS chunks one-by-one in idle time.
 * Uses the same loaders as React.lazy (no duplicate import() sources).
 * Order: Tasks → Friends → Profile → Leaderboard.
 * Never prefetches images / Roll / Mines / Tower / Shop.
 * Runs at most once per page session.
 *
 * Cleanup is intentionally a no-op: Home unmount / StrictMode remount must not
 * abort the sequential idle queue after the once-guard has armed.
 */
export function startMainTabChunkPrefetch(): () => void {
  if (prefetchSessionStarted) {
    return () => {}
  }
  prefetchSessionStarted = true

  const loaders: Array<{ name: string; load: () => Promise<unknown> }> = [
    { name: 'Tasks', load: loadTasksPage },
    { name: 'Friends', load: loadFriendsPage },
    { name: 'Profile', load: loadProfilePage },
    { name: 'Leaderboard', load: loadLeaderboardPage },
  ]

  let index = 0

  const tick = () => {
    if (index >= loaders.length) {
      return
    }
    const item = loaders[index]
    index += 1
    tabPerfMark('prefetch chunk start', { chunk: item.name })
    const t0 = performance.now()
    void item
      .load()
      .then(() => {
        tabPerfMark('prefetch chunk done', {
          chunk: item.name,
          ms: Math.round(performance.now() - t0),
        })
      })
      .catch(() => {
        tabPerfMark('prefetch chunk error', { chunk: item.name })
      })
      .finally(() => {
        scheduleIdle(tick, 2000)
      })
  }

  scheduleIdle(tick, 2000)

  return () => {}
}
