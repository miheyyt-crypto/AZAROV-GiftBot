/**
 * DEBUG / PERFORMANCE instrumentation for tab-switch diagnosis.
 * Default OFF — zero console noise, negligible overhead.
 *
 * Enable:
 *   localStorage.TAB_PERF = '1'
 *   or VITE_TAB_PERF=1
 *
 * Logs: [TAB-PERF] <event> <+ms from click> {...}
 * Does not change game/API/UI behavior.
 */

type TabPerfDetails = Record<string, string | number | boolean | null | undefined>

const NAV_MARK = 'tab-perf-nav'

let navT0 = 0
let navLabel = ''
let longTaskObserver: PerformanceObserver | null = null

export function isTabPerfEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    if (window.localStorage?.getItem('TAB_PERF') === '1') {
      return true
    }
  } catch {
    // ignore
  }
  return String(import.meta.env.VITE_TAB_PERF || '') === '1'
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

export function tabPerfMark(event: string, details?: TabPerfDetails): void {
  if (!isTabPerfEnabled()) {
    return
  }
  const elapsed = navT0 > 0 ? Math.round(now() - navT0) : 0
  if (details) {
    console.info(`[TAB-PERF] ${event} +${elapsed}ms`, { nav: navLabel, ...details })
  } else {
    console.info(`[TAB-PERF] ${event} +${elapsed}ms`, { nav: navLabel })
  }
  try {
    performance.mark(`tab-perf:${event}:${navLabel}:${elapsed}`)
  } catch {
    // ignore
  }
}

/** Call from BottomNav on pointerdown / click before route change. */
export function tabPerfClick(path: string): void {
  if (!isTabPerfEnabled()) {
    return
  }
  navT0 = now()
  navLabel = path
  try {
    performance.clearMarks?.(NAV_MARK)
    performance.mark(NAV_MARK)
  } catch {
    // ignore
  }
  tabPerfMark('click', { path })
  ensureLongTaskObserver()
}

export function tabPerfRouteStart(pathname: string): void {
  tabPerfMark('route start', { pathname })
}

export function wrapLazyImport<T>(
  name: string,
  loader: () => Promise<T>,
): () => Promise<T> {
  return () => {
    if (!isTabPerfEnabled()) {
      return loader()
    }
    tabPerfMark('chunk start', { chunk: name })
    const t0 = now()
    return loader().then((mod) => {
      tabPerfMark('chunk loaded', {
        chunk: name,
        ms: Math.round(now() - t0),
      })
      return mod
    })
  }
}

/** Call once from page component body (first render). */
export function tabPerfFirstRender(page: string): void {
  tabPerfMark('first render', { page })
}

/** Call from useEffect on mount. */
export function tabPerfMounted(page: string): void {
  tabPerfMark('component mounted', { page })
  // Approximate "interactive" after next frame + microtask.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tabPerfMark('interactive', { page })
      })
    })
  }
}

export function tabPerfApiStart(endpoint: string): void {
  tabPerfMark('API start', { endpoint })
}

export function tabPerfApiEnd(endpoint: string, ok: boolean, ms?: number): void {
  tabPerfMark('API end', { endpoint, ok, ms })
}

let imageRequestCount = 0
let imageLoadedCount = 0

export function tabPerfResetImageStats(): void {
  imageRequestCount = 0
  imageLoadedCount = 0
}

export function tabPerfImageEvent(
  event: 'image request' | 'image loaded',
  details?: TabPerfDetails,
): void {
  if (!isTabPerfEnabled()) {
    return
  }
  if (event === 'image request') {
    imageRequestCount += 1
  } else {
    imageLoadedCount += 1
  }
  tabPerfMark(event, {
    ...details,
    requested: imageRequestCount,
    loaded: imageLoadedCount,
  })
}

export function tabPerfShopImageSummary(extra?: TabPerfDetails): void {
  tabPerfMark('shop image summary', {
    requested: imageRequestCount,
    loaded: imageLoadedCount,
    ...extra,
  })
}

function ensureLongTaskObserver(): void {
  if (longTaskObserver || typeof PerformanceObserver === 'undefined') {
    return
  }
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      if (!isTabPerfEnabled()) {
        return
      }
      for (const entry of list.getEntries()) {
        const duration = Math.round(entry.duration)
        if (duration < 50) {
          continue
        }
        tabPerfMark('long-task', {
          duration,
          start: Math.round(entry.startTime),
          name: entry.name,
        })
      }
    })
    longTaskObserver.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit)
  } catch {
    longTaskObserver = null
  }
}
