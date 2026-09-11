/**
 * Temporary Roll/Desktop scroll diagnostics.
 * Enable verbose hooks: localStorage.setItem('ROLL_SCROLL_DEBUG','1'); location.reload()
 */

type ScrollDump = {
  t: number
  label: string
  embed: boolean
  scrollY: number
  docElTop: number
  bodyTop: number
  rootTop: number
  innerH: number
  vvH: number | null
  docScrollH: number
  docClientH: number
  bodyScrollH: number
  bodyClientH: number
  rootScrollH: number | null
  rootClientH: number | null
  header: { top: number; bottom: number } | null
  wheel: { top: number; bottom: number } | null
  bet: { top: number; bottom: number } | null
  list: { top: number; bottom: number } | null
}

function rectOf(el: Element | null): { top: number; bottom: number } | null {
  if (!el) {
    return null
  }
  const r = el.getBoundingClientRect()
  return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
}

export function dumpRollScrollState(label: string): ScrollDump {
  const root = document.getElementById('root')
  const roll = document.querySelector('.roll-page')
  const sections = roll
    ? Array.from(roll.querySelectorAll(':scope > section.roll-glass'))
    : []
  const dump: ScrollDump = {
    t: Date.now(),
    label,
    embed: document.documentElement.classList.contains('app-desktop-embed'),
    scrollY: window.scrollY,
    docElTop: document.documentElement.scrollTop,
    bodyTop: document.body.scrollTop,
    rootTop: root?.scrollTop ?? -1,
    innerH: window.innerHeight,
    vvH: window.visualViewport?.height ?? null,
    docScrollH: document.documentElement.scrollHeight,
    docClientH: document.documentElement.clientHeight,
    bodyScrollH: document.body.scrollHeight,
    bodyClientH: document.body.clientHeight,
    rootScrollH: root?.scrollHeight ?? null,
    rootClientH: root?.clientHeight ?? null,
    header: rectOf(roll?.querySelector(':scope > header') ?? null),
    wheel: rectOf(document.querySelector('.roll-wheel-stage')),
    bet: rectOf(sections[0] ?? null),
    list: rectOf(sections[sections.length - 1] ?? null),
  }
  console.info('[ROLL SCROLL]', label, dump)
  return dump
}

/** List overflow scroll parents for Roll. */
export function dumpScrollParents(label: string): void {
  const start = document.querySelector('.roll-page') || document.getElementById('root')
  const rows: Array<Record<string, string | number>> = []
  let el: Element | null = start
  while (el && el !== document.documentElement.parentElement) {
    const s = getComputedStyle(el)
    const oy = s.overflowY
    if (oy === 'auto' || oy === 'scroll' || oy === 'hidden' || oy === 'overlay') {
      const htmlEl = el as HTMLElement
      rows.push({
        el: `${el.tagName}${el.id ? '#' + el.id : ''}.${String(el.className).slice(0, 40)}`,
        overflowY: oy,
        clientH: htmlEl.clientHeight,
        scrollH: htmlEl.scrollHeight,
        scrollTop: htmlEl.scrollTop,
        position: s.position,
        canScroll: htmlEl.scrollHeight > htmlEl.clientHeight + 1 ? 1 : 0,
      })
    }
    el = el.parentElement
  }
  console.info('[ROLL SCROLL PARENTS]', label, rows)
}

let hooksInstalled = false

/** Patch scrollIntoView / scrollTo to log stacks when ROLL_SCROLL_DEBUG=1. */
export function installRollScrollDebugHooks(): void {
  if (hooksInstalled) {
    return
  }
  if (typeof window === 'undefined') {
    return
  }
  let enabled = false
  try {
    enabled = localStorage.getItem('ROLL_SCROLL_DEBUG') === '1'
  } catch {
    enabled = false
  }
  if (!enabled) {
    return
  }
  hooksInstalled = true

  const origIntoView = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function scrollIntoViewPatched(
    this: Element,
    ...args: Parameters<typeof origIntoView>
  ) {
    console.warn('[ROLL SCROLL] scrollIntoView on', this, new Error().stack)
    return origIntoView.apply(this, args)
  }

  const origScrollTo = window.scrollTo.bind(window)
  window.scrollTo = ((...args: Parameters<typeof window.scrollTo>) => {
    console.warn('[ROLL SCROLL] window.scrollTo', args, new Error().stack)
    return origScrollTo(...args)
  }) as typeof window.scrollTo

  const root = document.getElementById('root')
  root?.addEventListener(
    'scroll',
    () => {
      console.info('[ROLL SCROLL] #root scrollTop=', root.scrollTop)
    },
    { passive: true },
  )
  window.addEventListener(
    'scroll',
    () => {
      console.info('[ROLL SCROLL] window scrollY=', window.scrollY)
    },
    { passive: true },
  )

  console.info('[ROLL SCROLL] debug hooks installed')
}
