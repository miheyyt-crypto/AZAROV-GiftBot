import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultDataDir = path.join(moduleDir, 'data')
const projectRoot = path.resolve(moduleDir, '..')

const LOCK_TIMEOUT_MS = 15_000
const LOCK_RETRY_MS = 25
const STALE_LOCK_MS = 60_000

export class StoreCorruptError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'StoreCorruptError'
    this.code = 'STORE_CORRUPT'
    this.cause = cause
  }
}

/**
 * Resolve the JSON store directory.
 * Prefer AZAROV_STORE_DIR. In production, fall back to Railway Volume mount `/data`
 * when present — otherwise the container filesystem is wiped on every redeploy.
 */
export function getDataDir() {
  const fromEnv = String(process.env.AZAROV_STORE_DIR || '').trim()
  if (fromEnv) {
    return path.resolve(fromEnv)
  }

  if (process.env.NODE_ENV === 'production' && existsSync('/data')) {
    return '/data'
  }

  return defaultDataDir
}

export function getStorePath() {
  return path.join(getDataDir(), 'store.json')
}

function getLockPath() {
  return `${getStorePath()}.lock`
}

function getBackupPath(storePath = getStorePath()) {
  return `${storePath}.bak`
}

/**
 * True when the store dir is expected to survive Railway redeploys.
 * Ephemeral = inside the app image (`server/data` / project tree).
 */
export function isPersistentStoreDir(dir = getDataDir()) {
  const normalized = path.resolve(dir)
  const ephemeralDefault = path.resolve(defaultDataDir)

  if (normalized === ephemeralDefault || normalized.startsWith(`${ephemeralDefault}${path.sep}`)) {
    return false
  }

  // Explicitly under the project checkout (still wiped on redeploy without a volume).
  if (
    normalized === projectRoot ||
    normalized.startsWith(`${projectRoot}${path.sep}`)
  ) {
    return false
  }

  return true
}

export function createEmptyStore() {
  return {
    version: 4,
    users: {},
    referralIndex: {},
    referrals: {},
    events: {},
    coinTransactions: {},
    orders: {},
    caseOpenings: {},
    partnerSubmissions: {},
    partnerAccountBinds: {},
    webSessions: {},
    kickAccounts: {},
    kickByTelegram: {},
    kickOAuthStates: {},
    kickFollows: {},
  }
}

function migrateStore(store) {
  store.users = store.users || {}
  store.referralIndex = store.referralIndex || {}
  store.referrals = store.referrals || {}
  store.events = store.events || {}
  store.coinTransactions = store.coinTransactions || {}
  store.orders = store.orders || {}
  store.caseOpenings = store.caseOpenings || {}
  store.partnerSubmissions = store.partnerSubmissions || {}
  store.partnerAccountBinds = store.partnerAccountBinds || {}
  store.webSessions = store.webSessions || {}
  store.kickAccounts = store.kickAccounts || {}
  store.kickByTelegram = store.kickByTelegram || {}
  store.kickOAuthStates = store.kickOAuthStates || {}
  store.kickFollows = store.kickFollows || {}
  return store
}

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4)
  const ia = new Int32Array(sab)
  Atomics.wait(ia, 0, 0, ms)
}

function ensureDataDir() {
  const dataDir = getDataDir()
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
}

function tryClearStaleLock() {
  const lockPath = getLockPath()
  try {
    const content = readFileSync(lockPath, 'utf8')
    const ts = Number(String(content).split('\n')[1] || 0)
    if (ts > 0 && Date.now() - ts > STALE_LOCK_MS) {
      unlinkSync(lockPath)
      return true
    }
  } catch {
    // Missing or unreadable lock — leave for the next attempt.
  }
  return false
}

function acquireFileLock() {
  ensureDataDir()
  const lockPath = getLockPath()
  const started = Date.now()
  let clearedStale = false

  while (true) {
    try {
      const fd = openSync(lockPath, 'wx')
      try {
        writeFileSync(fd, `${process.pid}\n${Date.now()}`)
      } catch {
        // Lock ownership still holds even if metadata write fails.
      }
      return { fd, lockPath }
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }

      if (!clearedStale && Date.now() - started > 1_000) {
        clearedStale = tryClearStaleLock()
        if (clearedStale) {
          continue
        }
      }

      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw new Error('store_lock_timeout')
      }

      sleepSync(LOCK_RETRY_MS)
    }
  }
}

function releaseFileLock(lock) {
  if (!lock) {
    return
  }
  try {
    closeSync(lock.fd)
  } catch {
    // ignore
  }
  try {
    unlinkSync(lock.lockPath)
  } catch {
    // ignore
  }
}

function parseStoreRaw(raw, storePath) {
  if (!String(raw).trim()) {
    throw new StoreCorruptError('store_empty')
  }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('store_invalid_shape')
    }
    return migrateStore({
      ...createEmptyStore(),
      ...parsed,
    })
  } catch (error) {
    if (error instanceof StoreCorruptError) {
      throw error
    }
    try {
      copyFileSync(storePath, `${storePath}.corrupt-${Date.now()}`)
    } catch {
      // Best-effort quarantine copy.
    }
    throw new StoreCorruptError('store_parse_failed', error)
  }
}

/**
 * Load store. Fail closed if the file exists but is unreadable/corrupt —
 * never return an empty store that would wipe production data on save.
 * If primary is missing, try `.bak` restore before creating an empty store.
 */
export function loadStore() {
  const storePath = getStorePath()
  const backupPath = getBackupPath(storePath)

  if (!existsSync(storePath) && existsSync(backupPath)) {
    try {
      ensureDataDir()
      copyFileSync(backupPath, storePath)
      console.warn('[store] primary store.json missing — restored from store.json.bak')
    } catch (error) {
      throw new StoreCorruptError('store_backup_restore_failed', error)
    }
  }

  if (!existsSync(storePath)) {
    return createEmptyStore()
  }

  let raw
  try {
    raw = readFileSync(storePath, 'utf8')
  } catch (error) {
    throw new StoreCorruptError('store_unreadable', error)
  }

  try {
    return parseStoreRaw(raw, storePath)
  } catch (error) {
    // Corrupt primary: try backup before failing closed.
    if (existsSync(backupPath)) {
      try {
        const bakRaw = readFileSync(backupPath, 'utf8')
        const restored = parseStoreRaw(bakRaw, backupPath)
        console.warn('[store] primary store.json corrupt — loaded from store.json.bak')
        return restored
      } catch {
        // fall through
      }
    }
    throw error
  }
}

export function saveStore(store) {
  ensureDataDir()

  const storePath = getStorePath()
  const payload = JSON.stringify(store, null, 2)
  const tempPath = `${storePath}.tmp`
  writeFileSync(tempPath, payload)

  try {
    const fd = openSync(tempPath, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // fsync is best-effort (some environments disallow it).
  }

  renameSync(tempPath, storePath)

  // Rotating backups on the same volume so a bad write can be recovered.
  try {
    const bak = getBackupPath(storePath)
    const bakPrev = `${storePath}.bak.1`
    if (existsSync(bak)) {
      copyFileSync(bak, bakPrev)
    }
    copyFileSync(storePath, bak)
  } catch {
    // Backup is best-effort; primary write already succeeded.
  }
}

export function userKey(telegramId) {
  return String(telegramId)
}

export function getUser(telegramId) {
  return withStoreRead((store) => store.users[userKey(telegramId)] || null)
}

export function saveUser(store, user) {
  store.users[userKey(user.telegramId)] = user
  if (user.referralCode) {
    store.referralIndex[String(user.referralCode).toUpperCase()] = user.telegramId
  }
}

/**
 * Cross-process + in-process exclusive lock around load→mutate→save.
 * Use readOnly for GET paths so we do not rewrite the whole ledger on every read.
 */
export function withStore(updater, { readOnly = false } = {}) {
  const lock = acquireFileLock()
  try {
    const store = loadStore()
    const result = updater(store)
    if (!readOnly) {
      saveStore(store)
    }
    return result
  } finally {
    releaseFileLock(lock)
  }
}

export function withStoreRead(reader) {
  return withStore(reader, { readOnly: true })
}

export async function withStoreAsync(updater, { readOnly = false } = {}) {
  const lock = acquireFileLock()
  try {
    const store = loadStore()
    const result = await updater(store)
    if (!readOnly) {
      saveStore(store)
    }
    return result
  } finally {
    releaseFileLock(lock)
  }
}

/**
 * Safe diagnostics for boot logs / health (no secrets, no user PII dumps).
 */
export function getStoreDiagnostics() {
  const dir = getDataDir()
  const storePath = getStorePath()
  const backupPath = getBackupPath(storePath)
  const persistent = isPersistentStoreDir(dir)
  const fromEnv = Boolean(String(process.env.AZAROV_STORE_DIR || '').trim())
  let usersCount = 0
  let bytes = 0
  let exists = false
  let backupExists = existsSync(backupPath)

  try {
    exists = existsSync(storePath)
    if (exists) {
      bytes = statSync(storePath).size
      const store = loadStore()
      usersCount = Object.keys(store.users || {}).length
    }
  } catch (error) {
    return {
      dir,
      storePath,
      exists,
      backupExists,
      persistent,
      source: fromEnv ? 'AZAROV_STORE_DIR' : dir === '/data' ? 'railway_/data' : 'default_ephemeral',
      usersCount: 0,
      bytes: 0,
      error: error instanceof Error ? error.message : 'store_diag_failed',
    }
  }

  return {
    dir,
    storePath,
    exists,
    backupExists,
    persistent,
    source: fromEnv ? 'AZAROV_STORE_DIR' : dir === '/data' ? 'railway_/data' : 'default_ephemeral',
    usersCount,
    bytes,
  }
}

/**
 * Fail production boot when the store would live on ephemeral disk
 * (balances/tasks wiped on every Railway redeploy).
 */
export function assertPersistentStoreOrExit() {
  if (process.env.NODE_ENV !== 'production') {
    return getStoreDiagnostics()
  }

  if (String(process.env.AZAROV_ALLOW_EPHEMERAL_STORE || '').trim() === '1') {
    console.warn(
      '[store] AZAROV_ALLOW_EPHEMERAL_STORE=1 — balances/tasks WILL be lost on redeploy.',
    )
    return getStoreDiagnostics()
  }

  const diag = getStoreDiagnostics()
  if (!diag.persistent) {
    console.error('[store] FATAL: account data would be stored on ephemeral disk.')
    console.error(`[store] current dir: ${diag.dir}`)
    console.error(
      '[store] On Railway: create a Volume, mount it at /data, set AZAROV_STORE_DIR=/data and AZAROV_UPLOADS_DIR=/data/uploads, use a single replica.',
    )
    console.error(
      '[store] Without a Volume, every deploy resets balances and completed tasks to empty.',
    )
    process.exit(1)
  }

  console.info('[store] persistent storage ok', {
    dir: diag.dir,
    source: diag.source,
    usersCount: diag.usersCount,
    exists: diag.exists,
    backupExists: diag.backupExists,
  })

  return diag
}
