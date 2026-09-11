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

import { ensureStreakFreezeInventoryMigration } from './inventory.mjs'
import { computeLevelProgress, computeXpFromStats } from './level.mjs'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultDataDir = path.join(moduleDir, 'data')
const projectRoot = path.resolve(moduleDir, '..')

const LOCK_TIMEOUT_MS = 15_000
const LOCK_RETRY_MS = 25
const STALE_LOCK_MS = 60_000

/** In-process cache: avoid re-parsing store.json on every getUser / toPublicUser / session. */
let memoryStore = null
let memoryMtimeMs = -1
let memoryStorePath = ''
/** When true, memoryStore has mutations not yet on disk — loadStore must not reload from stale file. */
let memoryDirty = false

/** Coalesce hot-path persists (Kick chat) into one disk write. */
let deferredPersistTimer = null
let deferredPersistPending = false
let deferredPersistInFlight = false
const DEFERRED_PERSIST_MS = Math.max(
  200,
  Math.min(5_000, Number(process.env.AZAROV_STORE_DEFER_MS) || 750),
)

/** Throttle expensive rotating .bak copies (volume I/O blocks the event loop). */
let lastBackupAtMs = 0
let writesSinceBackup = 0
const BACKUP_MIN_INTERVAL_MS = 30_000
const BACKUP_EVERY_N_WRITES = 25
let writesSinceFsync = 0
const FSYNC_EVERY_N_WRITES = 10

/** Lightweight request timing (slow only). */
let lastEventLoopSample = Date.now()
let lastEventLoopLagMs = 0
if (typeof setInterval === 'function') {
  const lagTimer = setInterval(() => {
    const now = Date.now()
    lastEventLoopLagMs = Math.max(0, now - lastEventLoopSample - 500)
    lastEventLoopSample = now
  }, 500)
  if (typeof lagTimer.unref === 'function') {
    lagTimer.unref()
  }
}

export function getEventLoopLagMs() {
  return lastEventLoopLagMs
}

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
    version: 23,
    users: {},
    referralIndex: {},
    referrals: {},
    events: {},
    coinTransactions: {},
    orders: {},
    inventory: {},
    caseOpenings: {},
    minesGames: {},
    towerGames: {},
    rollRounds: {},
    rollMeta: {
      nextDisplayId: 100001,
      previousGame: null,
      topGame: null,
      currentRoundId: null,
      lastResultRoundId: null,
    },
    promoCodes: {},
    promoUsages: {},
    withdrawals: {},
    broadcasts: {},
    partnerSubmissions: {},
    partnerAccountBinds: {},
    webSessions: {},
    kickAccounts: {},
    kickByTelegram: {},
    kickOAuthStates: {},
    kickFollows: {},
    kickStreamStreaks: {},
    kickWebhookEvents: {},
    kickLivestreamState: null,
    kickWatchStats: {},
    notifications: {},
    giveaways: {},
    giveawayParticipants: {},
    referralContests: {},
    communityAccessRequests: {},
    deviceIndex: {},
    ipHashIndex: {},
    antiAbuseAudit: {},
    pendingBotStarts: {},
    botLaunchStarts: {},
    appSettings: {
      maintenanceMode: false,
    },
  }
}

function migrateStore(store) {
  store.users = store.users || {}
  store.referralIndex = store.referralIndex || {}
  store.referrals = store.referrals || {}
  store.events = store.events || {}
  store.coinTransactions = store.coinTransactions || {}
  store.orders = store.orders || {}
  store.inventory = store.inventory || {}
  store.caseOpenings = store.caseOpenings || {}
  store.partnerSubmissions = store.partnerSubmissions || {}
  store.partnerAccountBinds = store.partnerAccountBinds || {}
  store.webSessions = store.webSessions || {}
  store.kickAccounts = store.kickAccounts || {}
  store.kickByTelegram = store.kickByTelegram || {}
  store.kickOAuthStates = store.kickOAuthStates || {}
  store.kickFollows = store.kickFollows || {}
  store.kickStreamStreaks = store.kickStreamStreaks || {}
  store.kickWebhookEvents = store.kickWebhookEvents || {}
  if (store.kickLivestreamState === undefined) {
    store.kickLivestreamState = null
  }
  store.kickWatchStats = store.kickWatchStats || {}
  store.notifications = store.notifications || {}
  store.giveaways = store.giveaways || {}
  store.giveawayParticipants = store.giveawayParticipants || {}
  store.communityAccessRequests = store.communityAccessRequests || {}
  store.minesGames = store.minesGames || {}
  store.towerGames = store.towerGames || {}
  store.rollRounds = store.rollRounds || {}
  store.rollMeta = store.rollMeta || {
    nextDisplayId: 100001,
    previousGame: null,
    topGame: null,
    currentRoundId: null,
    lastResultRoundId: null,
  }
  store.promoCodes = store.promoCodes || {}
  store.promoUsages = store.promoUsages || {}
  store.withdrawals = store.withdrawals || {}
  store.deviceIndex = store.deviceIndex || {}
  store.ipHashIndex = store.ipHashIndex || {}
  store.antiAbuseAudit = store.antiAbuseAudit || {}
  store.pendingBotStarts = store.pendingBotStarts || {}
  store.botLaunchStarts = store.botLaunchStarts || {}
  store.broadcasts = store.broadcasts || {}
  store.appSettings = store.appSettings || {}
  if (typeof store.appSettings.maintenanceMode !== 'boolean') {
    store.appSettings.maintenanceMode = false
  }

  // One-shot upgrade: pending streak-freeze orders → inventory (strategy B).
  if (Number(store.version) < 5) {
    ensureStreakFreezeInventoryMigration(store)
  } else {
    store.inventory = store.inventory || {}
  }

  // Additive v6: kick watch stats map (no data rewrite required).
  if (Number(store.version) < 6) {
    store.version = 6
  }

  // Additive v7: in-app notifications map.
  if (Number(store.version) < 7) {
    store.notifications = store.notifications || {}
    store.version = 7
  }

  // Additive v8: giveaways + participants maps.
  if (Number(store.version) < 8) {
    store.giveaways = store.giveaways || {}
    store.giveawayParticipants = store.giveawayParticipants || {}
    store.version = 8
  }

  // Additive v9: community access requests.
  if (Number(store.version) < 9) {
    store.communityAccessRequests = store.communityAccessRequests || {}
    store.version = 9
  }

  // Additive v10: mines games.
  if (Number(store.version) < 10) {
    store.minesGames = store.minesGames || {}
    store.version = 10
  }

  // v11: level-up coin rewards — seed claimed levels for existing users (no backfill).
  if (Number(store.version) < 11) {
    for (const user of Object.values(store.users || {})) {
      if (!user || user.levelRewardsSeeded) {
        continue
      }
      const watchSeconds = Math.max(
        0,
        Math.floor(
          Number(
            store.kickWatchStats?.[String(user.telegramId)]?.totalWatchSeconds ?? user.watchSeconds,
          ) || 0,
        ),
      )
      const xp = computeXpFromStats({
        chatMessages: user.chatMessages,
        watchSeconds,
      })
      const computed = computeLevelProgress(xp).level
      const through = Math.max(1, Math.max(Number(user.peakLevel) || 0, computed))
      user.peakLevel = through
      user.claimedLevelRewards = Array.from({ length: through }, (_, index) => index + 1)
      user.levelRewardsSeeded = true
    }
    store.version = 11
  }

  // Additive v12: tower games.
  if (Number(store.version) < 12) {
    store.towerGames = store.towerGames || {}
    store.version = 12
  }

  // Additive v13: promo codes + per-user usages.
  if (Number(store.version) < 13) {
    store.promoCodes = store.promoCodes || {}
    store.promoUsages = store.promoUsages || {}
    store.version = 13
  }

  // Additive v14: cash prize withdrawals (Welvura ID).
  if (Number(store.version) < 14) {
    store.withdrawals = store.withdrawals || {}
    store.version = 14
  }

  // Additive v15: hard anti-multi-account device/IP indexes.
  // Existing users are grandfathered (antiAbuseBound=true) without claiming shared IPs.
  if (Number(store.version) < 15) {
    store.deviceIndex = store.deviceIndex || {}
    store.ipHashIndex = store.ipHashIndex || {}
    store.antiAbuseAudit = store.antiAbuseAudit || {}
    store.pendingBotStarts = store.pendingBotStarts || {}
    const now = new Date().toISOString()
    for (const user of Object.values(store.users || {})) {
      if (!user || typeof user !== 'object') {
        continue
      }
      if (user.createdAt == null) {
        user.createdAt = now
      }
      if (user.blocked == null) {
        user.blocked = false
      }
      if (user.blockReason === undefined) {
        user.blockReason = null
      }
      if (user.blockedAt === undefined) {
        user.blockedAt = null
      }
      if (user.primaryDeviceId === undefined) {
        user.primaryDeviceId = null
      }
      if (user.primaryIpHash === undefined) {
        user.primaryIpHash = null
      }
      // Do not auto-block legacy accounts that may share NAT/IP.
      user.antiAbuseBound = true
      user.antiAbuseLegacy = true
    }
    store.version = 15
  }

  // v16: mark all pre-existing accounts as legacy so shared-Wi-Fi grandfathers
  // are never retro-blocked when reclaiming IP/device from slipped multi-accounts.
  // New registrations after this deploy keep antiAbuseLegacy=false (createUser).
  if (Number(store.version) < 16) {
    for (const user of Object.values(store.users || {})) {
      if (!user || typeof user !== 'object') {
        continue
      }
      if (user.antiAbuseLegacy == null) {
        user.antiAbuseLegacy = true
      }
    }
    store.version = 16
  }

  // v17: one-shot purge of completed giveaways (empty "Завершённые" for a clean slate).
  if (Number(store.version) < 17) {
    store.giveaways = store.giveaways || {}
    store.giveawayParticipants = store.giveawayParticipants || {}
    const completedIds = new Set()
    for (const [id, row] of Object.entries(store.giveaways)) {
      if (row && row.status === 'completed') {
        completedIds.add(id)
        delete store.giveaways[id]
      }
    }
    for (const key of Object.keys(store.giveawayParticipants)) {
      const row = store.giveawayParticipants[key]
      const giveawayId = row?.giveawayId != null ? String(row.giveawayId) : String(key).split(':')[0]
      if (completedIds.has(giveawayId)) {
        delete store.giveawayParticipants[key]
      }
    }
    store.version = 17
  }

  // v18: one-shot full unban of accounts blocked by multi-account anti-abuse.
  if (Number(store.version) < 18) {
    store.deviceIndex = store.deviceIndex || {}
    store.ipHashIndex = store.ipHashIndex || {}
    store.antiAbuseAudit = store.antiAbuseAudit || {}
    let unbannedCount = 0
    for (const user of Object.values(store.users || {})) {
      if (!user || typeof user !== 'object') {
        continue
      }
      if (!user.blocked && user.blockReason !== 'MULTI_ACCOUNT') {
        continue
      }
      user.blocked = false
      user.blockReason = null
      user.blockedAt = null
      user.antiAbuseBound = true
      user.antiAbuseLegacy = true
      unbannedCount += 1
    }
    // Clear exclusive device/IP claims so twins are not immediately conflicted again.
    store.deviceIndex = {}
    store.ipHashIndex = {}
    const auditId = `MULTI_ACCOUNT_UNBAN_ALL:0:${Date.now()}:migration`
    store.antiAbuseAudit[auditId] = {
      id: auditId,
      type: 'MULTI_ACCOUNT_UNBAN_ALL',
      telegramId: 0,
      deviceId: null,
      ipHash: null,
      reason: 'store_migration_v18',
      count: unbannedCount,
      timestamp: new Date().toISOString(),
    }
    if (unbannedCount > 0) {
      console.info('[anti-abuse] migration v18 unbanned users', { unbannedCount })
    }
    store.version = 18
  }

  // v19: permanently remove account bans — unban everyone, drop indexes.
  if (Number(store.version) < 19) {
    store.pendingBotStarts = store.pendingBotStarts || {}
    let unbannedCount = 0
    for (const user of Object.values(store.users || {})) {
      if (!user || typeof user !== 'object') {
        continue
      }
      if (user.blocked || user.blockReason) {
        unbannedCount += 1
      }
      user.blocked = false
      user.blockReason = null
      user.blockedAt = null
      user.antiAbuseBound = true
      user.primaryDeviceId = null
      user.primaryIpHash = null
    }
    store.deviceIndex = {}
    store.ipHashIndex = {}
    store.antiAbuseAudit = {}
    console.info('[anti-abuse] migration v19 removed bans', { unbannedCount })
    store.version = 19
  }

  // v20: one-shot unlink Kick for @lamkustg (ops request).
  if (Number(store.version) < 20) {
    const needle = 'lamkustg'
    let target = null
    for (const user of Object.values(store.users || {})) {
      if (!user || typeof user !== 'object') continue
      const tg = String(user.username || '')
        .trim()
        .replace(/^@+/, '')
        .toLowerCase()
      const kick = String(user.kickUsername || '')
        .trim()
        .replace(/^@+/, '')
        .toLowerCase()
      if (tg === needle || kick === needle) {
        target = user
        break
      }
    }
    if (target) {
      store.kickAccounts = store.kickAccounts || {}
      store.kickByTelegram = store.kickByTelegram || {}
      store.kickFollows = store.kickFollows || {}
      store.kickStreamStreaks = store.kickStreamStreaks || {}
      const tgKey = String(target.telegramId)
      const kickId =
        (store.kickByTelegram[tgKey] && String(store.kickByTelegram[tgKey])) ||
        (target.kickUserId ? String(target.kickUserId) : '') ||
        ''
      target.kickVerified = false
      target.kickUserId = null
      target.kickUsername = null
      target.kickDisplayName = null
      target.kickAvatarUrl = null
      target.kickLinkedAt = null
      if (Array.isArray(target.completedTasks)) {
        target.completedTasks = target.completedTasks.filter(
          (id) => !['kick-connect', 'kick-follow', 'kick-nickname'].includes(String(id)),
        )
      }
      if (store.kickByTelegram[tgKey]) delete store.kickByTelegram[tgKey]
      if (kickId && store.kickAccounts[kickId]) delete store.kickAccounts[kickId]
      if (kickId && store.kickFollows[kickId]) delete store.kickFollows[kickId]
      if (store.kickStreamStreaks[tgKey]) delete store.kickStreamStreaks[tgKey]
      console.info('[kick] migration v20 unlinked user', {
        telegramId: target.telegramId,
        username: target.username || null,
        previousKickUserId: kickId || null,
      })
    } else {
      console.info('[kick] migration v20: user @lamkustg not found — nothing to unlink')
    }
    store.version = 20
  }

  // Additive v21: Roll PvP rounds + meta.
  if (Number(store.version) < 21) {
    store.rollRounds = store.rollRounds || {}
    store.rollMeta = store.rollMeta || {
      nextDisplayId: 100001,
      previousGame: null,
      topGame: null,
      currentRoundId: null,
      lastResultRoundId: null,
    }
    store.version = 21
  }

  // Additive v22: app settings (maintenance mode).
  if (Number(store.version) < 22) {
    store.appSettings = store.appSettings || {}
    if (typeof store.appSettings.maintenanceMode !== 'boolean') {
      store.appSettings.maintenanceMode = false
    }
    store.version = 22
  }

  // Additive v23: referral contest finalization records.
  if (Number(store.version) < 23) {
    store.referralContests = store.referralContests || {}
    store.version = 23
  }

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
    memoryStore = createEmptyStore()
    memoryMtimeMs = -1
    memoryStorePath = storePath
    return memoryStore
  }

  let mtimeMs = -1
  try {
    mtimeMs = Number(statSync(storePath).mtimeMs) || -1
  } catch {
    mtimeMs = -1
  }

  if (
    memoryStore &&
    memoryStorePath === storePath &&
    (memoryDirty || (mtimeMs >= 0 && memoryMtimeMs === mtimeMs))
  ) {
    // Re-run migrateStore so intentional version rollbacks (tests / repair) still upgrade.
    return migrateStore(memoryStore)
  }

  let raw
  try {
    raw = readFileSync(storePath, 'utf8')
  } catch (error) {
    throw new StoreCorruptError('store_unreadable', error)
  }

  try {
    const store = parseStoreRaw(raw, storePath)
    memoryStore = store
    memoryMtimeMs = mtimeMs
    memoryStorePath = storePath
    return store
  } catch (error) {
    // Corrupt primary: try backup before failing closed.
    if (existsSync(backupPath)) {
      try {
        const bakRaw = readFileSync(backupPath, 'utf8')
        const restored = parseStoreRaw(bakRaw, backupPath)
        console.warn('[store] primary store.json corrupt — loaded from store.json.bak')
        memoryStore = restored
        memoryMtimeMs = -1
        memoryStorePath = storePath
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
  const t0 = performance.now()
  // Compact JSON: pretty-print doubled write size/time on every session/API write.
  const payload = JSON.stringify(store)
  const stringifyMs = performance.now() - t0
  const tempPath = `${storePath}.tmp`
  writeFileSync(tempPath, payload)
  const writeMs = performance.now() - t0 - stringifyMs

  writesSinceFsync += 1
  const forceFsync = process.env.AZAROV_STORE_FSYNC === '1'
  if (forceFsync || writesSinceFsync >= FSYNC_EVERY_N_WRITES) {
    writesSinceFsync = 0
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
  }

  renameSync(tempPath, storePath)

  try {
    memoryStore = store
    memoryMtimeMs = Number(statSync(storePath).mtimeMs) || Date.now()
    memoryStorePath = storePath
    memoryDirty = false
  } catch {
    memoryStore = store
    memoryMtimeMs = Date.now()
    memoryStorePath = storePath
    memoryDirty = false
  }

  // Rotating backups: not on every write — volume copy of a large store blocks the event loop.
  writesSinceBackup += 1
  const now = Date.now()
  const dueByTime = now - lastBackupAtMs >= BACKUP_MIN_INTERVAL_MS
  const dueByCount = writesSinceBackup >= BACKUP_EVERY_N_WRITES
  let backupMs = 0
  if (dueByTime || dueByCount) {
    const b0 = performance.now()
    try {
      const bak = getBackupPath(storePath)
      const bakPrev = `${storePath}.bak.1`
      if (existsSync(bak)) {
        copyFileSync(bak, bakPrev)
      }
      copyFileSync(storePath, bak)
      lastBackupAtMs = now
      writesSinceBackup = 0
    } catch {
      // Backup is best-effort; primary write already succeeded.
    }
    backupMs = performance.now() - b0
  }

  const totalMs = performance.now() - t0
  if (totalMs >= 40) {
    console.info('[STORE WRITE]', {
      bytes: payload.length,
      stringify_ms: Math.round(stringifyMs),
      write_ms: Math.round(writeMs),
      backup_ms: Math.round(backupMs),
      total_ms: Math.round(totalMs),
    })
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
 * Protects concurrent requests on ONE Node process / ONE Railway replica only.
 * Does NOT provide distributed locking across multiple replicas — keep numReplicas=1.
 * Use readOnly for GET paths so we do not rewrite the whole ledger on every read.
 *
 * If updater returns `{ __storeDirty: false }`, skip persist (warm session no-ops).
 * Options:
 * - readOnly: never persist
 * - deferPersist: mutate under lock, keep memory dirty, flush after DEFERRED_PERSIST_MS
 */
export function withStore(updater, { readOnly = false, deferPersist = false } = {}) {
  const lock = acquireFileLock()
  try {
    const store = loadStore()
    const result = updater(store)
    const skipPersist =
      result &&
      typeof result === 'object' &&
      Object.prototype.hasOwnProperty.call(result, '__storeDirty') &&
      result.__storeDirty === false

    memoryStore = store
    memoryStorePath = getStorePath()

    const forceImmediate =
      result &&
      typeof result === 'object' &&
      result.__storeImmediate === true

    if (!readOnly && !skipPersist) {
      if (deferPersist && !forceImmediate) {
        memoryDirty = true
        scheduleDeferredPersist()
      } else {
        saveStore(store)
      }
    }

    if (
      result &&
      typeof result === 'object' &&
      !Array.isArray(result) &&
      (Object.prototype.hasOwnProperty.call(result, '__storeDirty') ||
        Object.prototype.hasOwnProperty.call(result, '__storeImmediate'))
    ) {
      const rest = { ...result }
      delete rest.__storeDirty
      delete rest.__storeImmediate
      return rest
    }
    return result
  } finally {
    releaseFileLock(lock)
  }
}

function scheduleDeferredPersist() {
  deferredPersistPending = true
  if (deferredPersistInFlight || deferredPersistTimer) {
    return
  }
  deferredPersistTimer = setTimeout(() => {
    deferredPersistTimer = null
    void flushDeferredPersist()
  }, DEFERRED_PERSIST_MS)
  if (typeof deferredPersistTimer.unref === 'function') {
    deferredPersistTimer.unref()
  }
}

function flushDeferredPersist() {
  if (deferredPersistInFlight) {
    deferredPersistPending = true
    return
  }
  if (!deferredPersistPending && !memoryDirty) {
    return
  }
  deferredPersistPending = false
  deferredPersistInFlight = true
  const lock = acquireFileLock()
  try {
    const store = loadStore()
    if (memoryDirty) {
      saveStore(store)
    }
  } catch (error) {
    console.error('[STORE] deferred flush failed', {
      message: error instanceof Error ? error.message : 'unknown_error',
    })
    deferredPersistPending = true
  } finally {
    releaseFileLock(lock)
    deferredPersistInFlight = false
    if (deferredPersistPending || memoryDirty) {
      scheduleDeferredPersist()
    }
  }
}

/** Force any deferred hot writes to disk (tests / graceful shutdown). */
export function flushStoreNow() {
  if (deferredPersistTimer) {
    clearTimeout(deferredPersistTimer)
    deferredPersistTimer = null
  }
  deferredPersistPending = false
  if (!memoryDirty) {
    return
  }
  const lock = acquireFileLock()
  try {
    const store = loadStore()
    saveStore(store)
  } finally {
    releaseFileLock(lock)
  }
}

/**
 * Read path: no exclusive lock. Writers use atomic tmp+rename, so readers see
 * the previous or next consistent file. Avoids serializing all GETs behind writers
 * and prevents Atomics.wait lock spins from blocking read-only traffic.
 */
export function withStoreRead(reader) {
  return reader(loadStore())
}

/**
 * Persist versioned store migrations (e.g. legacy streak-freeze → inventory).
 * Safe to call on boot; no-op after migration event is saved.
 */
export function persistStoreMigrations() {
  return withStore((store) => ensureStreakFreezeInventoryMigration(store))
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
      // Prefer cached store; avoid full disk parse on every health probe when warm.
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
