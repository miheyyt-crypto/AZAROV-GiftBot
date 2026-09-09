import crypto from 'node:crypto'

import { withStore, withStoreRead } from './store.mjs'
import { addCoins, spendCoins, TX_TYPE, utcNow } from './wallet.mjs'

export const TOWER_MIN_BET = 100
export const TOWER_CELLS_PER_FLOOR = 3
export const TOWER_SAFE_PER_FLOOR = 1
export const TOWER_MAX_FLOORS = 11

/**
 * Fixed reference multipliers (×) for floors 1..11.
 * Same for every player — never derived from exponential fair-odds formula.
 */
export const TOWER_MULTIPLIERS = Object.freeze([
  1.0, 1.44, 2.16, 3.24, 4.86, 7.29, 10.93, 16.4, 24.6, 36.91, 55.36,
])

/** Integer basis points (10000 = 1.00×) — mirrors TOWER_MULTIPLIERS exactly. */
export const TOWER_MULTIPLIER_BPS = Object.freeze([
  10_000, 14_400, 21_600, 32_400, 48_600, 72_900, 109_300, 164_000, 246_000, 369_100, 553_600,
])

function ensureMaps(store) {
  store.towerGames = store.towerGames || {}
  store.events = store.events || {}
}

function requestEventKey(userId, requestId) {
  return `tower:request:${userId}:${requestId}`
}

function createGameId() {
  return `tower_${crypto.randomBytes(12).toString('hex')}`
}

/**
 * Multiplier in basis points after `floorsCleared` successful floors.
 * floorsCleared 0 → 1.00× (cashout blocked until ≥1)
 * floorsCleared N → TOWER_MULTIPLIER_BPS[N-1] (floor N in the reference table)
 */
export function towerMultiplierBps(floorsCleared) {
  const k = Math.max(0, Math.floor(Number(floorsCleared) || 0))
  if (k <= 0) {
    return TOWER_MULTIPLIER_BPS[0]
  }
  const index = Math.min(k, TOWER_MULTIPLIER_BPS.length) - 1
  return TOWER_MULTIPLIER_BPS[index]
}

export function getTowerMultiplier(floorsCleared) {
  const k = Math.max(0, Math.floor(Number(floorsCleared) || 0))
  if (k <= 0) {
    return TOWER_MULTIPLIERS[0]
  }
  const index = Math.min(k, TOWER_MULTIPLIERS.length) - 1
  return TOWER_MULTIPLIERS[index]
}

export function towerPotentialWin(bet, floorsCleared) {
  const stake = Math.max(0, Math.floor(Number(bet) || 0))
  const bps = towerMultiplierBps(floorsCleared)
  if (stake <= 0 || bps <= 0) {
    return 0
  }
  return Math.floor((stake * bps) / 10_000)
}

export function buildTowerMultiplierTable(maxFloors = TOWER_MAX_FLOORS) {
  const floors = Math.min(
    TOWER_MULTIPLIERS.length,
    Math.max(1, Math.floor(Number(maxFloors) || TOWER_MAX_FLOORS)),
  )
  return Array.from({ length: floors }, (_, index) => {
    const floor = index + 1
    return {
      floor,
      multiplierBps: TOWER_MULTIPLIER_BPS[index],
      multiplier: TOWER_MULTIPLIERS[index],
    }
  })
}

function generateSafeCells(maxFloors, cellsPerFloor) {
  return Array.from({ length: maxFloors }, () => crypto.randomInt(0, cellsPerFloor))
}

function findActiveGame(store, userId) {
  return Object.values(store.towerGames || {}).find(
    (game) => Number(game.userId) === Number(userId) && game.status === 'playing',
  )
}

function publicGame(game, { includeSafe = false } = {}) {
  if (!game) {
    return null
  }

  const floorsCleared = Math.max(0, Math.floor(Number(game.floorsCleared) || 0))
  const multiplierBps = towerMultiplierBps(floorsCleared)
  const potentialWin = towerPotentialWin(game.bet, floorsCleared)
  const finished = game.status === 'won' || game.status === 'lost'
  const showSafe = includeSafe || finished
  const picks = Array.isArray(game.picks) ? game.picks.map((row) => ({ ...row })) : []

  return {
    id: game.id,
    status: game.status,
    bet: game.bet,
    cellsPerFloor: game.cellsPerFloor || TOWER_CELLS_PER_FLOOR,
    maxFloors: game.maxFloors || TOWER_MAX_FLOORS,
    currentFloor: game.currentFloor,
    floorsCleared,
    picks,
    multiplierBps,
    multiplier: getTowerMultiplier(floorsCleared),
    potentialWin: game.status === 'won' ? Number(game.payout) || potentialWin : potentialWin,
    payout: game.payout == null ? null : Number(game.payout),
    canCashout: game.status === 'playing' && floorsCleared >= 1,
    multipliers: buildTowerMultiplierTable(game.maxFloors || TOWER_MAX_FLOORS),
    safeCells: showSafe && Array.isArray(game.safeCells) ? [...game.safeCells] : null,
    createdAt: game.createdAt,
    finishedAt: game.finishedAt || null,
  }
}

export function startTowerGameOnStore(store, userId, { bet, requestId }) {
  ensureMaps(store)
  const uid = Number(userId)
  const user = store.users?.[String(uid)]
  if (!user) {
    return { success: false, code: 'USER_MISSING', message: 'Сначала открой приложение.' }
  }

  const rid = String(requestId || '').trim()
  if (rid.length < 8 || rid.length > 128) {
    return { success: false, code: 'INVALID_REQUEST_ID', message: 'Некорректный requestId.' }
  }

  const cached = store.events[requestEventKey(uid, rid)]
  if (cached?.gameId && store.towerGames[cached.gameId]) {
    return {
      success: true,
      alreadyProcessed: true,
      game: publicGame(store.towerGames[cached.gameId]),
    }
  }

  if (findActiveGame(store, uid)) {
    return {
      success: false,
      code: 'GAME_ACTIVE',
      message: 'Сначала заверши текущую игру.',
      game: publicGame(findActiveGame(store, uid)),
    }
  }

  const stake = Math.floor(Number(bet))
  if (!Number.isInteger(stake) || stake < TOWER_MIN_BET) {
    return {
      success: false,
      code: 'INVALID_BET',
      message: `Минимальная ставка — ${TOWER_MIN_BET} монет.`,
    }
  }

  const balance = Number(user.balance) || 0
  if (balance < stake) {
    return {
      success: false,
      code: 'INSUFFICIENT_FUNDS',
      message: 'Недостаточно монет для ставки.',
    }
  }

  const gameId = createGameId()
  const openingId = `tower:bet:${uid}:${gameId}`
  const spend = spendCoins(store, user, stake, TX_TYPE.TOWER_BET, `${openingId}:spend`, {
    referenceId: openingId,
    description: `Ставка в Tower (${TOWER_MAX_FLOORS} этажей)`,
  })

  if (!spend.spent && spend.reason === 'insufficient') {
    return {
      success: false,
      code: 'INSUFFICIENT_FUNDS',
      message: 'Недостаточно монет для ставки.',
    }
  }

  const now = utcNow()
  const game = {
    id: gameId,
    userId: uid,
    bet: stake,
    cellsPerFloor: TOWER_CELLS_PER_FLOOR,
    maxFloors: TOWER_MAX_FLOORS,
    safeCells: generateSafeCells(TOWER_MAX_FLOORS, TOWER_CELLS_PER_FLOOR),
    currentFloor: 1,
    floorsCleared: 0,
    picks: [],
    status: 'playing',
    payout: null,
    createdAt: now,
    finishedAt: null,
    requestId: rid,
  }

  store.towerGames[gameId] = game
  store.events[requestEventKey(uid, rid)] = {
    eventId: requestEventKey(uid, rid),
    userId: uid,
    gameId,
    reason: 'TOWER_START',
    createdAt: now,
  }

  return { success: true, game: publicGame(game) }
}

export function pickTowerCellOnStore(store, userId, { gameId, floor, cellIndex, requestId }) {
  ensureMaps(store)
  const uid = Number(userId)
  const user = store.users?.[String(uid)]
  if (!user) {
    return { success: false, code: 'USER_MISSING', message: 'Сначала открой приложение.' }
  }

  const id = String(gameId || '').trim()
  const game = store.towerGames[id]
  if (!game || Number(game.userId) !== uid) {
    return { success: false, code: 'NOT_FOUND', message: 'Игра не найдена.' }
  }

  const floorNum = Math.floor(Number(floor))
  const cell = Math.floor(Number(cellIndex))
  const cells = game.cellsPerFloor || TOWER_CELLS_PER_FLOOR
  const maxFloors = game.maxFloors || TOWER_MAX_FLOORS

  if (!Number.isInteger(floorNum) || floorNum < 1 || floorNum > maxFloors) {
    return { success: false, code: 'INVALID_FLOOR', message: 'Некорректный этаж.' }
  }
  if (!Number.isInteger(cell) || cell < 0 || cell >= cells) {
    return { success: false, code: 'INVALID_CELL', message: 'Некорректная клетка.' }
  }

  if (game.status !== 'playing') {
    return {
      success: false,
      code: 'GAME_FINISHED',
      message: 'Игра уже завершена.',
      game: publicGame(game, { includeSafe: true }),
    }
  }

  if (floorNum !== game.currentFloor) {
    return {
      success: false,
      code: 'WRONG_FLOOR',
      message: 'Можно выбирать только на текущем этаже.',
      game: publicGame(game),
    }
  }

  const pickKey = `tower:pick:${id}:${floorNum}:${cell}`
  if (store.events[pickKey]?.done) {
    return {
      success: true,
      alreadyProcessed: true,
      hitDanger: Boolean(store.events[pickKey].hitDanger),
      game: publicGame(game, { includeSafe: game.status !== 'playing' }),
    }
  }

  const safeCell = game.safeCells[floorNum - 1]
  const hitDanger = cell !== safeCell
  store.events[pickKey] = {
    eventId: pickKey,
    done: true,
    hitDanger,
    requestId: String(requestId || ''),
    createdAt: utcNow(),
  }

  game.picks = [
    ...(Array.isArray(game.picks) ? game.picks : []),
    { floor: floorNum, cell, safe: !hitDanger, safeCell },
  ]

  if (hitDanger) {
    game.status = 'lost'
    game.payout = 0
    game.finishedAt = utcNow()
    return {
      success: true,
      hitDanger: true,
      game: publicGame(game, { includeSafe: true }),
    }
  }

  game.floorsCleared = floorNum
  if (game.floorsCleared >= maxFloors) {
    return cashoutTowerOnStore(store, uid, { gameId: id, requestId: `auto:${id}` })
  }

  game.currentFloor = floorNum + 1
  return {
    success: true,
    hitDanger: false,
    game: publicGame(game),
  }
}

export function cashoutTowerOnStore(store, userId, { gameId, requestId }) {
  ensureMaps(store)
  const uid = Number(userId)
  const user = store.users?.[String(uid)]
  if (!user) {
    return { success: false, code: 'USER_MISSING', message: 'Сначала открой приложение.' }
  }

  const id = String(gameId || '').trim()
  const game = store.towerGames[id]
  if (!game || Number(game.userId) !== uid) {
    return { success: false, code: 'NOT_FOUND', message: 'Игра не найдена.' }
  }

  const cashoutKey = `tower:cashout:${id}`
  if (store.events[cashoutKey]?.done || game.status === 'won') {
    return {
      success: true,
      alreadyProcessed: true,
      game: publicGame(game, { includeSafe: true }),
    }
  }

  if (game.status === 'lost') {
    return {
      success: false,
      code: 'GAME_FINISHED',
      message: 'Игра уже проиграна.',
      game: publicGame(game, { includeSafe: true }),
    }
  }

  if (game.status !== 'playing') {
    return {
      success: false,
      code: 'GAME_FINISHED',
      message: 'Игра уже завершена.',
      game: publicGame(game, { includeSafe: true }),
    }
  }

  const floorsCleared = Math.max(0, Math.floor(Number(game.floorsCleared) || 0))
  if (floorsCleared < 1) {
    return {
      success: false,
      code: 'NOTHING_TO_CASHOUT',
      message: 'Пройди хотя бы один этаж.',
      game: publicGame(game),
    }
  }

  const payout = towerPotentialWin(game.bet, floorsCleared)
  if (payout < 1) {
    return {
      success: false,
      code: 'INVALID_PAYOUT',
      message: 'Некорректный выигрыш.',
      game: publicGame(game),
    }
  }

  const winEvent = `tower:game:${id}:win`
  const grant = addCoins(store, user, payout, TX_TYPE.TOWER_WIN, winEvent, {
    referenceId: id,
    description: `Выигрыш в Tower (×${getTowerMultiplier(floorsCleared).toFixed(2)}, этаж ${floorsCleared})`,
  })

  if (!grant.granted && grant.reason !== 'already_granted') {
    return {
      success: false,
      code: 'CREDIT_FAILED',
      message: 'Не удалось начислить выигрыш. Попробуй ещё раз.',
    }
  }

  game.status = 'won'
  game.payout = payout
  game.finishedAt = utcNow()
  store.events[cashoutKey] = {
    eventId: cashoutKey,
    done: true,
    payout,
    requestId: String(requestId || ''),
    createdAt: game.finishedAt,
  }

  return {
    success: true,
    hitDanger: false,
    game: publicGame(game, { includeSafe: true }),
  }
}

export function getActiveTowerGameOnStore(store, userId) {
  ensureMaps(store)
  const game = findActiveGame(store, userId)
  return { success: true, game: publicGame(game) }
}

export function startTowerGame(userId, payload) {
  return withStore((store) => startTowerGameOnStore(store, userId, payload))
}

export function pickTowerCell(userId, payload) {
  return withStore((store) => pickTowerCellOnStore(store, userId, payload))
}

export function cashoutTower(userId, payload) {
  return withStore((store) => cashoutTowerOnStore(store, userId, payload))
}

export function getActiveTowerGame(userId) {
  return withStoreRead((store) => getActiveTowerGameOnStore(store, userId))
}
