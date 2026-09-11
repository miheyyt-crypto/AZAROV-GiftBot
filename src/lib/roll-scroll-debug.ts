/**
 * Desktop Roll scroll TRACE — diagnosis only.
 *
 * Always-on when html.app-desktop-embed (Telegram Desktop / fine pointer).
 * On-screen HUD + window.__ROLL_SCROLL_TRACE__ timeline.
 *
 * Verbose stacks: localStorage.ROLL_SCROLL_DEBUG = '1'
 * Force HUD in any env: ?rollScrollDebug=1
 */

export type TracePoint = {
  t: number
  label: string
  route: string
  scrollY: number
  docTop: number
  bodyTop: number
  rootTop: number
  rootScrollH: number
  rootClientH: number
  rootOverflowY: string
  rootRectTop: number
  headerTop: number | null
  wheelTop: number | null
  betTop: number | null
  listTop: number | null
  active: string
  scrollRestoration: string
  note?: string
}

type TraceStore = {
  points: TracePoint[]
  changes: Array<{ t: number; from: number; to: number; via: string; stack?: string }>
  startedAt: number
}

declare global {
  interface Window {
    __ROLL_SCROLL_TRACE__?: TraceStore
    __rollScrollResetting?: boolean
    __rollScrollTraceHud?: HTMLDivElement | null
  }
}

const MAX_POINTS = 80

function debugVerbose(): boolean {
  try {
    if (localStorage.getItem('ROLL_SCROLL_DEBUG') === '1') {
      return true
    }
  } catch {
    /* ignore */
  }
  return new URLSearchParams(location.search).has('rollScrollDebug')
}

export function isDesktopScrollTraceEnabled(): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  // HUD covered Header on Desktop — opt-in only.
  return debugVerbose()
}

function ensureStore(): TraceStore {
  if (!window.__ROLL_SCROLL_TRACE__) {
    window.__ROLL_SCROLL_TRACE__ = { points: [], changes: [], startedAt: Date.now() }
  }
  return window.__ROLL_SCROLL_TRACE__
}

function rectTop(el: Element | null): number | null {
  if (!el) {
    return null
  }
  return Math.round(el.getBoundingClientRect().top)
}

function activeLabel(): string {
  const a = document.activeElement
  if (!a || a === document.body) {
    return 'BODY'
  }
  return `${a.tagName}${a.id ? '#' + a.id : ''}.${String((a as HTMLElement).className || '').slice(0, 28)}`
}

export function captureScrollTrace(label: string, note?: string): TracePoint {
  const root = document.getElementById('root')
  const roll = document.querySelector('.roll-page')
  const sections = roll
    ? Array.from(roll.querySelectorAll(':scope > section.roll-glass'))
    : []
  const rootStyle = root ? getComputedStyle(root) : null
  const point: TracePoint = {
    t: Date.now(),
    label,
    route: location.pathname,
    scrollY: Math.round(window.scrollY),
    docTop: Math.round(document.documentElement.scrollTop),
    bodyTop: Math.round(document.body.scrollTop),
    rootTop: root ? Math.round(root.scrollTop) : -1,
    rootScrollH: root?.scrollHeight ?? -1,
    rootClientH: root?.clientHeight ?? -1,
    rootOverflowY: rootStyle?.overflowY ?? 'n/a',
    rootRectTop: root ? Math.round(root.getBoundingClientRect().top) : -1,
    headerTop: rectTop(roll?.querySelector(':scope > header') ?? null),
    wheelTop: rectTop(document.querySelector('.roll-wheel-stage')),
    betTop: rectTop(sections[0] ?? null),
    listTop: rectTop(sections.length ? sections[sections.length - 1] : null),
    active: activeLabel(),
    scrollRestoration:
      typeof history !== 'undefined' && 'scrollRestoration' in history
        ? String(history.scrollRestoration)
        : 'n/a',
    note,
  }
  const store = ensureStore()
  store.points.push(point)
  if (store.points.length > MAX_POINTS) {
    store.points.shift()
  }
  console.info('[ROLL TRACE]', label, point)
  updateHud(store)
  return point
}

function updateHud(store: TraceStore): void {
  if (!isDesktopScrollTraceEnabled()) {
    return
  }
  let hud = window.__rollScrollTraceHud
  if (!hud) {
    hud = document.createElement('div')
    hud.id = 'roll-scroll-trace-hud'
    hud.setAttribute('data-roll-diag', '1')
    Object.assign(hud.style, {
      position: 'fixed',
      left: '4px',
      top: '4px',
      zIndex: '2147483646',
      maxWidth: 'min(96vw, 420px)',
      maxHeight: '46vh',
      overflow: 'auto',
      padding: '8px 10px',
      borderRadius: '10px',
      background: 'rgba(0,0,0,0.82)',
      color: '#9ef01a',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      pointerEvents: 'none',
      whiteSpace: 'pre-wrap',
      boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
    } as CSSStyleDeclaration)
    document.body.appendChild(hud)
    window.__rollScrollTraceHud = hud
  }
  const last = store.points[store.points.length - 1]
  const lastChange = store.changes[store.changes.length - 1]
  const lines = [
    'ROLL SCROLL TRACE (desktop diag)',
    `route=${last?.route ?? '?'} rest=${last?.scrollRestoration ?? '?'}`,
    `root.scrollTop=${last?.rootTop ?? '?'}  winY=${last?.scrollY ?? '?'}`,
    `root.clientH=${last?.rootClientH ?? '?'} scrollH=${last?.rootScrollH ?? '?'}`,
    `canScrollRoot=${last && last.rootScrollH > last.rootClientH + 1 ? 'YES' : 'NO'}`,
    `root.overflowY=${last?.rootOverflowY ?? '?'}`,
    `docTop=${last?.docTop ?? '?'} bodyTop=${last?.bodyTop ?? '?'}`,
    `header.top=${last?.headerTop ?? 'n/a'} wheel.top=${last?.wheelTop ?? 'n/a'}`,
    `bet.top=${last?.betTop ?? 'n/a'} list.top=${last?.listTop ?? 'n/a'}`,
    `rootRect.top=${last?.rootRectTop ?? '?'}`,
    `body.ovY=${getComputedStyle(document.body).overflowY} html.ovY=${getComputedStyle(document.documentElement).overflowY}`,
    `scrollingElement=${document.scrollingElement?.tagName ?? '?'}`,
    `active=${last?.active ?? '?'}`,
    lastChange
      ? `LAST CHANGE ${lastChange.from}→${lastChange.to} via=${lastChange.via}`
      : 'LAST CHANGE (none yet)',
    '--- timeline ---',
    ...store.points.slice(-12).map((p) => {
      const dt = p.t - store.startedAt
      return `T+${dt}ms ${p.label} root=${p.rootTop} H=${p.headerTop} W=${p.wheelTop} sH=${p.rootScrollH}`
    }),
  ]
  hud.textContent = lines.join('\n')
}

function recordChange(from: number, to: number, via: string, stack?: string): void {
  if (from === to) {
    return
  }
  const store = ensureStore()
  store.changes.push({ t: Date.now(), from, to, via, stack })
  if (store.changes.length > 40) {
    store.changes.shift()
  }
  console.warn('[ROLL TRACE CHANGE]', { from, to, via, stack: stack?.slice(0, 800) })
  captureScrollTrace(`change:${via}`, `${from}→${to}`)
}

let installed = false
let lastRootTop = 0
let scrollListenArmed = false

/** Install traps + scroll listeners. Safe to call repeatedly. */
export function installDesktopScrollTrace(): void {
  if (typeof window === 'undefined' || installed) {
    return
  }
  if (!isDesktopScrollTraceEnabled() && !debugVerbose()) {
    // Still allow later enable when class appears — poll once.
    window.setTimeout(() => {
      if (isDesktopScrollTraceEnabled()) {
        installDesktopScrollTrace()
      }
    }, 0)
    return
  }
  installed = true
  ensureStore().startedAt = Date.now()

  // Experiment (diag only): disable browser history scroll restoration.
  // Record previous value; do not treat as permanent product fix until confirmed.
  try {
    const prev = history.scrollRestoration
    history.scrollRestoration = 'manual'
    captureScrollTrace('hist-restoration-manual', `was=${prev}`)
  } catch {
    captureScrollTrace('hist-restoration-failed')
  }

  // Trap JS assignments to scrollTop on #root.
  try {
    const proto = HTMLElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'scrollTop')
    if (desc?.set && desc.get) {
      const nativeGet = desc.get
      const nativeSet = desc.set
      Object.defineProperty(proto, 'scrollTop', {
        configurable: true,
        enumerable: desc.enumerable ?? false,
        get() {
          return nativeGet.call(this)
        },
        set(value: number) {
          if ((this as HTMLElement).id === 'root') {
            const from = Number(nativeGet.call(this)) || 0
            const to = Number(value) || 0
            const via = window.__rollScrollResetting ? 'our-reset' : 'js-setter'
            if (from !== to) {
              recordChange(
                from,
                to,
                via,
                debugVerbose() ? new Error().stack : undefined,
              )
            }
          }
          return nativeSet.call(this, value)
        },
      })
    }
  } catch (err) {
    console.warn('[ROLL TRACE] scrollTop trap failed', err)
  }

  armRootScrollListener()
  captureScrollTrace('trace-installed')
}

function armRootScrollListener(): void {
  if (scrollListenArmed) {
    return
  }
  const root = document.getElementById('root')
  if (!root) {
    window.setTimeout(armRootScrollListener, 50)
    return
  }
  scrollListenArmed = true
  lastRootTop = root.scrollTop

  let lastLog = 0
  root.addEventListener(
    'scroll',
    () => {
      const to = root.scrollTop
      const from = lastRootTop
      lastRootTop = to
      if (window.__rollScrollResetting) {
        return
      }
      if (from === to) {
        return
      }
      const now = Date.now()
      if (now - lastLog < 32 && Math.abs(to - from) < 2) {
        return
      }
      lastLog = now
      recordChange(from, to, 'native-scroll-event')
    },
    { passive: true },
  )
}

/** Mark intentional resets so the trap can label them. */
export function withScrollResetMarker(fn: () => void): void {
  window.__rollScrollResetting = true
  try {
    fn()
  } finally {
    window.__rollScrollResetting = false
    const root = document.getElementById('root')
    if (root) {
      lastRootTop = root.scrollTop
    }
  }
}

/** Full post-navigation timeline — READ ONLY (never forces scrollTop). */
export function runRollScrollTimeline(bootstrapped: boolean): void {
  if (!isDesktopScrollTraceEnabled()) {
    return
  }
  installDesktopScrollTrace()
  captureScrollTrace(bootstrapped ? 'T11-bootstrapped' : 'T2-roll-mount')

  queueMicrotask(() => captureScrollTrace('T5-microtask'))
  requestAnimationFrame(() => {
    captureScrollTrace('T6-raf1')
    requestAnimationFrame(() => captureScrollTrace('T7-raf2'))
  })
  window.setTimeout(() => captureScrollTrace('T8-100ms'), 100)
  window.setTimeout(() => captureScrollTrace('T9-300ms'), 300)
}

export function traceBeforeNavigate(to: string): void {
  if (!isDesktopScrollTraceEnabled()) {
    installDesktopScrollTrace()
  }
  captureScrollTrace('T0-before-nav', `to=${to}`)
}

export function traceRouteChanged(pathname: string): void {
  if (!isDesktopScrollTraceEnabled() && pathname !== '/roll') {
    return
  }
  installDesktopScrollTrace()
  captureScrollTrace('T1-route-changed', pathname)
}
