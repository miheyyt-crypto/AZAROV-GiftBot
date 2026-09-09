import crypto from 'node:crypto'

import { withStore, withStoreRead } from './store.mjs'
import { addCoins, spendCoins, TX_TYPE, utcNow } from './wallet.mjs'

export const MINES_GRID_SIZE = 25
export const MINES_MIN_BET = 100
export const MINES_ALLOWED_COUNTS = Object.freeze([3, 5, 7, 10, 15, 20, 24])
/** Fair multiplier × this / 10000 (9700 ≈ 3% house edge). */
export const MINES_HOUSE_EDGE_BPS = 9700

function ensureMaps(store) {
  store.minesGames = store.minesGames || {}
  store.events = store.events || {}
}

function requestEventKey(userId, requestId) {
  return `mines:request:${userId}:${requestId}`
}

function createGameId() {
  return `mines_${crypto.randomBytes(12).toString('hex')}`
}

function shufflePick(count, poolSize) {
  const indices = Array.from({ length: poolSize }, (_, i) => i)
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1)
    const tmp = indices[i]
    indices[i] = indices[j]
    indices[j] = tmp
  }
  return indices.slice(0, count).sort((a, b) => a - b)
}

/**
 * Multiplier in basis points after `safeOpened` safe reveals.
 * 10000 = 1.00×. At 0 opens → 10000 (bet face value; cashout blocked until ≥1).
 */
export function minesMultiplierBps(
  safeOpened,
  mineCount,
  gridSize = MINES_GRID_SIZE,
  houseEdgeBps = MINES_HOUSE_EDGE_BPS,
) {
  const k = Math.max(0, Math.floor(Number(safeOpened) || 0))
  const mines = Math.floor(Number(mineCount) || 0)
  const n = Math.floor(Number(gridSize) || MINES_GRID_SIZE)
  const safeTotal = n - mines

  if (k <= 0) {
    return 10_000
  }
  if (mines < 1 || mines >= n || k > safeTotal) {
    return 0
  }

  let num = 1n
  let den = 1n
  for (let i = 0; i < k; i += 1) {
    num *= BigInt(n - i)
    den *= BigInt(safeTotal - i)
  }

  const edge = BigInt(Math.max(1, Math.floor(houseEdgeBps)))
  return Number((num * edge) / den)
}

export function minesPotentialWin(bet, safeOpened, mineCount) {
  const stake = Math.max(0, Math.floor(Number(bet) || 0))
  const bps = minesMultiplierBps(safeOpened, mineCount)
  if (stake <= 0 || bps <= 0) {
    return 0
  }
  return Math.floor((stake * bps) / 10_000)
}

function findActiveGame(store, userId) {
  return Object.values(store.minesGames || {}).find(
    (game) => Number(game.userId) === Number(userId) && game.status === 'playing',
  )
}

function publicGame(game, { includeMines = false } = {}) {
  if (!game) {
    return null
  }

  const safeOpened = Array.isArray(game.revealed) ? game.revealed.length : 0
  const multiplierBps = minesMultiplierBps(safeOpened, game.mineCount)
  const potentialWin = minesPotentialWin(game.bet, safeOpened, game.mineCount)
  const finished = game.status === 'won' || game.status === 'lost'
  const showMines = includeMines || finished

  return {
    id: game.id,
    status: game.status,
    bet: game.bet,
    mineCount: game.mineCount,
    gridSize: game.gridSize || MINES_GRID_SIZE,
    revealed: Array.isArray(game.revealed) ? [...game.revealed] : [],
    safeOpened,
    multiplierBps,
    multiplier: Number((multiplierBps / 10_000).toFixed(4)),
    potentialWin: game.status === 'won' ? Number(game.payout) || potentialWin : potentialWin,
    payout: game.payout == null ? null : Number(game.payout),
    canCashout: game.status === 'playing' && safeOpened >= 1,
    mineIndices: showMines && Array.isArray(game.mineIndices) ? [...game.mineIndices] : null,
    createdAt: game.createdAt,
    finishedAt: game.finishedAt || null,
  }
}

export function startMinesGameOnStore(store, userId, { bet, mineCount, requestId }) {
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
  if (cached?.gameId && store.minesGames[cached.gameId]) {
    return {
      success: true,
      alreadyProcessed: true,
      game: publicGame(store.minesGames[cached.gameId]),
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
  if (!Number.isInteger(stake) || stake < MINES_MIN_BET) {
    return {
      success: false,
      code: 'INVALID_BET',
      message: `Минимальная ставка — ${MINES_MIN_BET} монет.`,
    }
  }

  const mines = Math.floor(Number(mineCount))
  if (!MINES_ALLOWED_COUNTS.includes(mines)) {
    return {
      success: false,
      code: 'INVALID_MINES',
      message: 'Некорректное количество мин.',
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
  const openingId = `mines:bet:${uid}:${gameId}`
  const spend = spendCoins(store, user, stake, TX_TYPE.MINES_BET, `${openingId}:spend`, {
    referenceId: openingId,
    description: `Ставка в Mines (${mines} мин)`,
  })

  if (!spend.spent && spend.reason === 'insufficient') {
    return {
      success: false,
      code: 'INSUFFICIENT_FUNDS',
      message: 'Недостаточно монет для ставки.',
    }
  }

  const mineIndices = shufflePick(mines, MINES_GRID_SIZE)
  const now = utcNow()
  const game = {
    id: gameId,
    userId: uid,
    bet: stake,
    mineCount: mines,
    gridSize: MINES_GRID_SIZE,
    mineIndices,
    revealed: [],
    status: 'playing',
    payout: null,
    createdAt: now,
    finishedAt: null,
    requestId: rid,
  }

  store.minesGames[gameId] = game
  store.events[requestEventKey(uid, rid)] = {
    eventId: requestEventKey(uid, rid),
    userId: uid,
    gameId,
    reason: 'MINES_START',
    createdAt: now,
  }

  return { success: true, game: publicGame(game) }
}

export function revealMinesCellOnStore(store, userId, { gameId, cellIndex, requestId }) {
  ensureMaps(store)
  const uid = Number(userId)
  const user = store.users?.[String(uid)]
  if (!user) {
    return { success: false, code: 'USER_MISSING', message: 'Сначала открой приложение.' }
  }

  const id = String(gameId || '').trim()
  const game = store.minesGames[id]
  if (!game || Number(game.userId) !== uid) {
    return { success: false, code: 'NOT_FOUND', message: 'Игра не найдена.' }
  }

  const cell = Math.floor(Number(cellIndex))
  if (!Number.isInteger(cell) || cell < 0 || cell >= (game.gridSize || MINES_GRID_SIZE)) {
    return { success: false, code: 'INVALID_CELL', message: 'Некорректная клетка.' }
  }

  const revealKey = `mines:reveal:${id}:${cell}`
  if (store.events[revealKey]?.done) {
    return {
      success: true,
      alreadyProcessed: true,
      hitMine: Boolean(store.events[revealKey].hitMine),
      game: publicGame(game, { includeMines: game.status !== 'playing' }),
    }
  }

  if (game.status !== 'playing') {
    return {
      success: false,
      code: 'GAME_FINISHED',
      message: 'Игра уже завершена.',
      game: publicGame(game, { includeMines: true }),
    }
  }

  if (game.revealed.includes(cell)) {
    return {
      success: true,
      alreadyProcessed: true,
      hitMine: false,
      game: publicGame(game),
    }
  }

  const hitMine = game.mineIndices.includes(cell)
  store.events[revealKey] = {
    eventId: revealKey,
    done: true,
    hitMine,
    requestId: String(requestId || ''),
    createdAt: utcNow(),
  }

  if (hitMine) {
    game.status = 'lost'
    game.payout = 0
    game.finishedAt = utcNow()
    return {
      success: true,
      hitMine: true,
      game: publicGame(game, { includeMines: true }),
    }
  }

  game.revealed = [...game.revealed, cell]
  const safeTotal = (game.gridSize || MINES_GRID_SIZE) - game.mineCount
  if (game.revealed.length >= safeTotal) {
    // Auto-cashout when all safe cells opened.
    return cashoutMinesOnStore(store, uid, { gameId: id, requestId: `auto:${id}` })
  }

  return {
    success: true,
    hitMine: false,
    game: publicGame(game),
  }
}

export function cashoutMinesOnStore(store, userId, { gameId, requestId }) {
  ensureMaps(store)
  const uid = Number(userId)
  const user = store.users?.[String(uid)]
  if (!user) {
    return { success: false, code: 'USER_MISSING', message: 'Сначала открой приложение.' }
  }

  const id = String(gameId || '').trim()
  const game = store.minesGames[id]
  if (!game || Number(game.userId) !== uid) {
    return { success: false, code: 'NOT_FOUND', message: 'Игра не найдена.' }
  }

  const cashoutKey = `mines:cashout:${id}`
  if (store.events[cashoutKey]?.done || game.status === 'won') {
    return {
      success: true,
      alreadyProcessed: true,
      game: publicGame(game, { includeMines: true }),
    }
  }

  if (game.status === 'lost') {
    return {
      success: false,
      code: 'GAME_FINISHED',
      message: 'Игра уже проиграна.',
      game: publicGame(game, { includeMines: true }),
    }
  }

  if (game.status !== 'playing') {
    return {
      success: false,
      code: 'GAME_FINISHED',
      message: 'Игра уже завершена.',
      game: publicGame(game, { includeMines: true }),
    }
  }

  const safeOpened = game.revealed.length
  if (safeOpened < 1) {
    return {
      success: false,
      code: 'NOTHING_TO_CASHOUT',
      message: 'Открой хотя бы одну безопасную клетку.',
      game: publicGame(game),
    }
  }

  const payout = minesPotentialWin(game.bet, safeOpened, game.mineCount)
  if (payout < 1) {
    return {
      success: false,
      code: 'INVALID_PAYOUT',
      message: 'Некорректный выигрыш.',
      game: publicGame(game),
    }
  }

  const winEvent = `mines:game:${id}:win`
  const grant = addCoins(store, user, payout, TX_TYPE.MINES_WIN, winEvent, {
    referenceId: id,
    description: `Выигрыш в Mines (×${(minesMultiplierBps(safeOpened, game.mineCount) / 10_000).toFixed(2)})`,
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
    hitMine: false,
    game: publicGame(game, { includeMines: true }),
  }
}

export function getActiveMinesGameOnStore(store, userId) {
  ensureMaps(store)
  const game = findActiveGame(store, userId)
  return { success: true, game: publicGame(game) }
}

export function startMinesGame(userId, payload) {
  return withStore((store) => startMinesGameOnStore(store, userId, payload))
}

export function revealMinesCell(userId, payload) {
  return withStore((store) => revealMinesCellOnStore(store, userId, payload))
}

export function cashoutMines(userId, payload) {
  return withStore((store) => cashoutMinesOnStore(store, userId, payload))
}

export function getActiveMinesGame(userId) {
  return withStoreRead((store) => getActiveMinesGameOnStore(store, userId))
}
