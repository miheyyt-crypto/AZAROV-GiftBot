import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultDataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const dataDir = process.env.AZAROV_STORE_DIR
  ? path.resolve(process.env.AZAROV_STORE_DIR)
  : defaultDataDir
const storePath = path.join(dataDir, 'store.json')
const lockPath = `${storePath}.lock`

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

export function createEmptyStore() {
  return {
    version: 3,
    users: {},
    referralIndex: {},
    referrals: {},
    events: {},
    coinTransactions: {},
    orders: {},
    caseOpenings: {},
    partnerSubmissions: {},
    partnerAccountBinds: {},
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
  return store
}

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4)
  const ia = new Int32Array(sab)
  Atomics.wait(ia, 0, 0, ms)
}

function ensureDataDir() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
}

function tryClearStaleLock() {
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

/**
 * Load store. Fail closed if the file exists but is unreadable/corrupt —
 * never return an empty store that would wipe production data on save.
 */
export function loadStore() {
  if (!existsSync(storePath)) {
    return createEmptyStore()
  }

  let raw
  try {
    raw = readFileSync(storePath, 'utf8')
  } catch (error) {
    throw new StoreCorruptError('store_unreadable', error)
  }

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
    try {
      copyFileSync(storePath, `${storePath}.corrupt-${Date.now()}`)
    } catch {
      // Best-effort quarantine copy.
    }
    throw new StoreCorruptError('store_parse_failed', error)
  }
}

export function saveStore(store) {
  ensureDataDir()

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
