/**
 * Cold-start preload: warm main-tab + mini-game JS chunks in parallel phases.
 * Progress is settle-based (no fake timers). Session is tracked separately
 * via markBootSessionSettled() from AuthGate — does not change auth semantics.
 *
 * Phase A (immediate, before createRoot): Tasks, Friends, Profile, Leaderboard.
 * Phase B (deferred, after first paint / double-rAF): Roll, Mines, Tower.
 */

import {
  loadFriendsPage,
  loadLeaderboardPage,
  loadMinesPage,
  loadProfilePage,
  loadRollRoute,
  loadTasksPage,
  loadTowerPage,
} from '@/lib/lazy-routes'

export type BootPreloadTaskId =
  | 'session'
  | 'Tasks'
  | 'Friends'
  | 'Profile'
  | 'Leaderboard'
  | 'RollRoute'
  | 'Mines'
  | 'Tower'

export type BootPreloadSnapshot = {
  /** 0–100, based on settled task weights only (deferred games count only after they start+settle). */
  progress: number
  /** Human-readable status for the loading screen. */
  label: string
  sessionDone: boolean
  /**
   * Immediate tab chunks settled (Tasks/Friends/Profile/Leaderboard).
   * AuthGate uses this to unblock the app shell — not deferred games.
   */
  chunksDone: boolean
  /** Session + immediate tabs settled (BootLoadingScreen may dismiss). */
  complete: boolean
  settledIds: BootPreloadTaskId[]
  activeId: BootPreloadTaskId | null
}

type ChunkDef = {
  id: Exclude<BootPreloadTaskId, 'session'>
  label: string
  weight: number
  load: () => Promise<unknown>
}

/** Per-chunk import budget — hang becomes failed/settled, never blocks forever. */
export const BOOT_CHUNK_TIMEOUT_MS = 10_000

const SESSION_WEIGHT = 3

const IMMEDIATE_CHUNK_DEFS: ChunkDef[] = [
  { id: 'Tasks', label: 'Задания', weight: 1, load: loadTasksPage },
  { id: 'Friends', label: 'Друзья', weight: 1, load: loadFriendsPage },
  { id: 'Profile', label: 'Профиль', weight: 1, load: loadProfilePage },
  { id: 'Leaderboard', label: 'Топ', weight: 1, load: loadLeaderboardPage },
]

const DEFERRED_CHUNK_DEFS: ChunkDef[] = [
  { id: 'RollRoute', label: 'Roll', weight: 1, load: loadRollRoute },
  { id: 'Mines', label: 'Mines', weight: 1, load: loadMinesPage },
  { id: 'Tower', label: 'Tower', weight: 1, load: loadTowerPage },
]

const ALL_CHUNK_DEFS = [...IMMEDIATE_CHUNK_DEFS, ...DEFERRED_CHUNK_DEFS]

const TOTAL_WEIGHT =
  SESSION_WEIGHT + ALL_CHUNK_DEFS.reduce((sum, t) => sum + t.weight, 0)

const settled = new Set<BootPreloadTaskId>()
const listeners = new Set<(snap: BootPreloadSnapshot) => void>()

let immediateStarted = false
let deferredStarted = false
let sessionDone = false
/** Immediate tab chunks only (AuthGate gate). */
let immediateChunksDone = false
let activeId: BootPreloadTaskId | null = 'session'
let lastLabel = 'Подключаем сессию…'

function buildSnapshot(): BootPreloadSnapshot {
  let settledWeight = 0
  if (sessionDone) {
    settledWeight += SESSION_WEIGHT
  }
  for (const def of ALL_CHUNK_DEFS) {
    if (settled.has(def.id)) {
      settledWeight += def.weight
    }
  }
  const progress = Math.min(100, Math.round((settledWeight / TOTAL_WEIGHT) * 100))
  const complete = sessionDone && immediateChunksDone
  return {
    progress,
    label: complete ? 'Готово' : lastLabel,
    sessionDone,
    chunksDone: immediateChunksDone,
    complete,
    settledIds: Array.from(settled),
    activeId: complete ? null : activeId,
  }
}

function emit(): void {
  const snap = buildSnapshot()
  for (const listener of listeners) {
    try {
      listener(snap)
    } catch {
      // ignore subscriber errors
    }
  }
}

function refreshLabel(): void {
  if (immediateChunksDone && sessionDone) {
    lastLabel = 'Готово'
    activeId = null
    return
  }
  if (!immediateChunksDone) {
    lastLabel = 'Загружаем разделы…'
    activeId = null
    return
  }
  lastLabel = 'Подключаем сессию…'
  activeId = 'session'
}

function markChunkSettled(id: ChunkDef['id']): void {
  if (settled.has(id)) {
    return
  }
  settled.add(id)
  if (IMMEDIATE_CHUNK_DEFS.every((d) => settled.has(d.id))) {
    immediateChunksDone = true
  }
  refreshLabel()
  emit()
}

function loadChunkWithTimeout(def: ChunkDef): Promise<void> {
  return new Promise((resolve) => {
    let finished = false
    const finish = () => {
      if (finished) {
        return
      }
      finished = true
      markChunkSettled(def.id)
      resolve()
    }

    const timer = window.setTimeout(finish, BOOT_CHUNK_TIMEOUT_MS)

    void def.load().then(
      () => {
        window.clearTimeout(timer)
        finish()
      },
      () => {
        window.clearTimeout(timer)
        finish()
      },
    )
  })
}

/**
 * Immediate phase: Tasks / Friends / Profile / Leaderboard (parallel).
 * Safe to call from main.tsx before createRoot.
 */
export function startColdStartPreload(): void {
  if (immediateStarted) {
    return
  }
  immediateStarted = true
  activeId = null
  lastLabel = 'Загружаем разделы…'
  emit()

  void Promise.allSettled(IMMEDIATE_CHUNK_DEFS.map((def) => loadChunkWithTimeout(def)))
}

/**
 * Deferred phase: Roll / Mines / Tower after first visual paint (double-rAF).
 * Module-level once-guard — independent of React component lifecycle.
 */
export function startDeferredGamePreload(): void {
  if (deferredStarted) {
    return
  }
  deferredStarted = true
  // Do not mark deferred chunks settled until each import settles/times out.
  if (!immediateChunksDone || !sessionDone) {
    lastLabel = 'Загружаем разделы…'
  }
  emit()

  void Promise.allSettled(DEFERRED_CHUNK_DEFS.map((def) => loadChunkWithTimeout(def)))
}

/**
 * Called from AuthGate when bootstrapSession path finishes (any outcome).
 * Does not alter auth — only advances the session preload weight.
 */
export function markBootSessionSettled(): void {
  if (sessionDone) {
    return
  }
  sessionDone = true
  settled.add('session')
  refreshLabel()
  emit()
}

export function getBootPreloadSnapshot(): BootPreloadSnapshot {
  return buildSnapshot()
}

export function subscribeBootPreload(listener: (snap: BootPreloadSnapshot) => void): () => void {
  listeners.add(listener)
  listener(buildSnapshot())
  return () => {
    listeners.delete(listener)
  }
}
