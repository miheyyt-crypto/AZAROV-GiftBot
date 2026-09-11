import crypto from 'node:crypto'

import { withStore } from './store.mjs'
import { addCoins, spendCoins, TX_TYPE, utcNow } from './wallet.mjs'
import { broadcastRollEvent, getRollSseClientCount } from './roll-bus.mjs'

export const ROLL_MAX_PLAYERS = 2
export const ROLL_MIN_BET = 100
export const ROLL_BETTING_DURATION_MS = 20_000
export const ROLL_SPIN_DURATION_MS = 5_000
export const ROLL_RESULT_HOLD_MS = 8_000
/** 10000 = 100% of pot to winner (no house edge). */
export const ROLL_PAYOUT_BPS = 10_000
export const ROLL_SPIN_EXTRA_TURNS = 6
/** Keep pointer off segment edges (fraction of segment size). */
export const ROLL_LANDING_EDGE_MARGIN = 0.12
export const ROLL_TICK_MS = 200

const SEGMENT_COLORS = ['#ff6a2b', '#b39ddb', '#4fc3f7', '#66bb6a', '#ffca28', '#ef5350']

function ensureMaps(store) {
  store.rollRounds = store.rollRounds || {}
  store.events = store.events || {}
  store.rollMeta = store.rollMeta || {
    nextDisplayId: 100001,
    previousGame: null,
    topGame: null,
    currentRoundId: null,
  }
  if (!Number.isFinite(Number(store.rollMeta.nextDisplayId))) {
    store.rollMeta.nextDisplayId = 100001
  }
}

function createRoundId() {
  return `roll_${crypto.randomBytes(12).toString('hex')}`
}

function nowMs() {
  return Date.now()
}

function potOf(round) {
  return (round.players || []).reduce((sum, p) => sum + (Number(p.bet) || 0), 0)
}

export function chancePercent(bet, total) {
  const b = Number(bet) || 0
  const t = Number(total) || 0
  if (t <= 0 || b <= 0) {
    return 0
  }
  return Math.round((b / t) * 10000) / 100
}

export function buildSegments(players) {
  const list = Array.isArray(players) ? players : []
  const total = potOf({ players: list })
  if (total <= 0 || list.length === 0) {
    return []
  }
  let cursor = 0
  return list.map((player, index) => {
    const bet = Number(player.bet) || 0
    const size = (360 * bet) / total
    const start = cursor
    const end = cursor + size
    cursor = end
    return {
      userId: Number(player.userId),
      username: player.username || '',
      photoUrl: player.photoUrl || '',
      bet,
      startDeg: start,
      endDeg: end,
      sizeDeg: size,
      chance: chancePercent(bet, total),
      color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
    }
  })
}

/**
 * Normalize degrees into [0, 360).
 */
export function normalizeDeg(deg) {
  const n = Number(deg) || 0
  return ((n % 360) + 360) % 360
}

/**
 * Angle under the fixed top pointer for a given CSS clockwise rotation.
 */
export function pointerLocalDeg(rotationDeg) {
  return normalizeDeg(-rotationDeg)
}

export function findSegmentAtLocalDeg(segments, localDeg) {
  const angle = normalizeDeg(localDeg)
  for (const seg of segments) {
    if (angle >= seg.startDeg && angle < seg.endDeg) {
      return seg
    }
  }
  return segments.length ? segments[segments.length - 1] : null
}

/**
 * Pick winner by raw bet weights using crypto.randomInt.
 * Returns { winnerUserId, roll, total }.
 */
export function pickWeightedWinner(players, randomInt = crypto.randomInt) {
  const list = Array.isArray(players) ? players : []
  const total = potOf({ players: list })
  if (total <= 0 || list.length === 0) {
    return { winnerUserId: null, roll: 0, total: 0 }
  }
  const roll = randomInt(0, total)
  let cumulative = 0
  for (const player of list) {
    cumulative += Number(player.bet) || 0
    if (roll < cumulative) {
      return { winnerUserId: Number(player.userId), roll, total }
    }
  }
  return { winnerUserId: Number(list[list.length - 1].userId), roll, total }
}

/**
 * Choose final wheel rotation so the pointer lands inside the winner segment.
 */
export function computeTargetAngle(segments, winnerUserId, extraTurns = ROLL_SPIN_EXTRA_TURNS) {
  const winner = segments.find((s) => Number(s.userId) === Number(winnerUserId))
  if (!winner || winner.sizeDeg <= 0) {
    return extraTurns * 360
  }
  const margin = Math.min(
    winner.sizeDeg * ROLL_LANDING_EDGE_MARGIN,
    Math.max(0.5, winner.sizeDeg / 2 - 0.25),
  )
  const usable = Math.max(0.01, winner.sizeDeg - margin * 2)
  const landLocal =
    winner.startDeg +
    winner.sizeDeg / 2 +
    (crypto.randomInt(0, 1001) / 1000 - 0.5) * (usable * 0.5)
  const clamped = Math.min(
    winner.endDeg - margin,
    Math.max(winner.startDeg + margin, landLocal),
  )
  // pointerLocal = normalize(-rotation) === clamped ⇒ rotation = normalize(-clamped)
  const base = normalizeDeg(-clamped)
  return base + Math.max(1, Math.floor(extraTurns)) * 360
}

function bumpRoundVersion(round) {
  round.version = (Number(round.version) || 0) + 1
  round.updatedAt = utcNow()
  return round.version
}

function roundFingerprint(round) {
  if (!round) {
    return ''
  }
  return [
    round.id,
    round.status,
    round.version,
    (round.players || []).length,
    round.bettingEndsAt || '',
    round.spinStartedAt || '',
    round.settledAt || '',
    round.winnerUserId ?? '',
  ].join('|')
}

function createEmptyRound(store) {
  const displayId = Number(store.rollMeta.nextDisplayId) || 100001
  store.rollMeta.nextDisplayId = displayId + 1
  const round = {
    id: createRoundId(),
    displayId,
    status: 'waiting',
    version: 1,
    players: [],
    bettingStartedAt: null,
    bettingEndsAt: null,
    winnerUserId: null,
    winnerChanceBps: null,
    targetAngle: null,
    spinStartedAt: null,
    spinEndsAt: null,
    pot: 0,
    payout: 0,
    settledAt: null,
    createdAt: utcNow(),
    updatedAt: utcNow(),
    completedAt: null,
  }
  store.rollRounds[round.id] = round
  store.rollMeta.currentRoundId = round.id
  return round
}

function getOrCreateCurrentRound(store) {
  ensureMaps(store)
  const id = store.rollMeta.currentRoundId
  if (id && store.rollRounds[id]) {
    return store.rollRounds[id]
  }
  return createEmptyRound(store)
}

function snapshotGameCard(round, winnerPlayer) {
  const total = potOf(round)
  const bet = Number(winnerPlayer?.bet) || 0
  const payout = Math.floor((total * ROLL_PAYOUT_BPS) / 10_000)
  return {
    roundId: round.id,
    displayId: round.displayId,
    winnerUsername: winnerPlayer?.username || '',
    winnerUserId: Number(winnerPlayer?.userId),
    winnerPhotoUrl: winnerPlayer?.photoUrl || '',
    winnerChance: chancePercent(bet, total),
    winnings: payout,
    multiplier: bet > 0 ? Math.round((payout / bet) * 100) / 100 : 0,
    createdAt: round.completedAt || utcNow(),
  }
}

function settleRound(store, round) {
  if (round.settledAt) {
    return { alreadySettled: true }
  }
  const winner = (round.players || []).find((p) => Number(p.userId) === Number(round.winnerUserId))
  if (!winner) {
    round.settledAt = utcNow()
    round.status = 'completed'
    round.completedAt = round.settledAt
    return { alreadySettled: false, paid: false }
  }

  const total = potOf(round)
  const payout = Math.floor((total * ROLL_PAYOUT_BPS) / 10_000)
  round.pot = total
  round.payout = payout

  const winnerUser = store.users[String(winner.userId)]
  if (winnerUser && payout > 0) {
    addCoins(store, winnerUser, payout, TX_TYPE.ROLL_WIN, `roll:settle:${round.id}`, {
      referenceId: round.id,
      description: `Выигрыш Roll #${round.displayId}`,
    })
  }

  round.settledAt = utcNow()
  round.status = 'completed'
  round.completedAt = round.settledAt

  const card = snapshotGameCard(round, winner)
  store.rollMeta.previousGame = card
  if (!store.rollMeta.topGame || Number(card.winnings) > Number(store.rollMeta.topGame.winnings || 0)) {
    store.rollMeta.topGame = card
  }
  store.rollMeta.lastResultRoundId = round.id

  return { alreadySettled: false, paid: true, payout }
}

/**
 * Advance round timers: betting → spin → settle → next waiting.
 * Returns whether the round fingerprint changed.
 */
export function advanceRollRoundOnStore(store, atMs = nowMs()) {
  ensureMaps(store)
  const round = getOrCreateCurrentRound(store)
  if (!round) {
    return { round: null, changed: false }
  }

  const before = roundFingerprint(round)

  if (round.status === 'waiting' && (round.players || []).length >= ROLL_MAX_PLAYERS) {
    round.status = 'betting'
    round.bettingStartedAt = new Date(atMs).toISOString()
    round.bettingEndsAt = new Date(atMs + ROLL_BETTING_DURATION_MS).toISOString()
    bumpRoundVersion(round)
  }

  if (round.status === 'betting') {
    const ends = Date.parse(round.bettingEndsAt || '')
    if (Number.isFinite(ends) && atMs >= ends) {
      round.status = 'locked'
      bumpRoundVersion(round)
    }
  }

  if (round.status === 'locked') {
    const segments = buildSegments(round.players)
    const { winnerUserId } = pickWeightedWinner(round.players)
    const winner = (round.players || []).find((p) => Number(p.userId) === Number(winnerUserId))
    const total = potOf(round)
    round.winnerUserId = winnerUserId
    round.winnerChanceBps = winner && total > 0 ? Math.floor((Number(winner.bet) * 10_000) / total) : 0
    round.targetAngle = computeTargetAngle(segments, winnerUserId)
    round.pot = total
    round.payout = Math.floor((total * ROLL_PAYOUT_BPS) / 10_000)
    round.spinStartedAt = new Date(atMs).toISOString()
    round.spinEndsAt = new Date(atMs + ROLL_SPIN_DURATION_MS).toISOString()
    round.status = 'spinning'
    bumpRoundVersion(round)
  }

  if (round.status === 'spinning') {
    const ends = Date.parse(round.spinEndsAt || '')
    if (Number.isFinite(ends) && atMs >= ends) {
      settleRound(store, round)
      bumpRoundVersion(round)
    }
  }

  if (round.status === 'completed') {
    const doneAt = Date.parse(round.completedAt || round.settledAt || '')
    if (Number.isFinite(doneAt) && atMs >= doneAt + ROLL_RESULT_HOLD_MS) {
      createEmptyRound(store)
    }
  }

  const current = getOrCreateCurrentRound(store)
  const changed = roundFingerprint(current) !== before || current.id !== round.id
  return { round: current, changed }
}

function publicPlayer(player, total) {
  const bet = Number(player.bet) || 0
  return {
    userId: Number(player.userId),
    username: player.username || '',
    firstName: player.firstName || '',
    photoUrl: player.photoUrl || '',
    bet,
    chance: chancePercent(bet, total),
    joinedAt: player.joinedAt || null,
  }
}

function publicRound(round) {
  if (!round) {
    return null
  }
  const total = potOf(round)
  const players = (round.players || []).map((p) => publicPlayer(p, total))
  const segments = buildSegments(round.players)
  const winner = players.find((p) => Number(p.userId) === Number(round.winnerUserId)) || null
  return {
    id: round.id,
    displayId: round.displayId,
    status: round.status,
    version: Number(round.version) || 1,
    updatedAt: round.updatedAt || round.createdAt,
    players,
    segments,
    pot: total,
    payout: Number(round.payout) || 0,
    bettingStartedAt: round.bettingStartedAt,
    bettingEndsAt: round.bettingEndsAt,
    spinStartedAt: round.spinStartedAt,
    spinEndsAt: round.spinEndsAt,
    targetAngle: round.targetAngle,
    winnerUserId: round.winnerUserId != null ? Number(round.winnerUserId) : null,
    winner,
    winnerChance: winner ? winner.chance : null,
    multiplier:
      winner && winner.bet > 0
        ? Math.round(((Number(round.payout) || total) / winner.bet) * 100) / 100
        : null,
    settledAt: round.settledAt,
    completedAt: round.completedAt,
    createdAt: round.createdAt,
    maxPlayers: ROLL_MAX_PLAYERS,
  }
}

function statePayload(store, viewerId = null) {
  advanceRollRoundOnStore(store)
  const round = getOrCreateCurrentRound(store)
  const meta = store.rollMeta
  let lastResult = null
  if (meta.lastResultRoundId && store.rollRounds[meta.lastResultRoundId]) {
    const finished = store.rollRounds[meta.lastResultRoundId]
    if (finished.status === 'completed' || finished.status === 'spinning') {
      lastResult = publicRound(finished)
    }
  }
  // While current is still spinning/completed, lastResult mirrors it for UI.
  if (round && (round.status === 'spinning' || round.status === 'completed')) {
    lastResult = publicRound(round)
  }

  const viewerInRound = Boolean(
    viewerId != null &&
      (round?.players || []).some((p) => Number(p.userId) === Number(viewerId)),
  )

  return {
    success: true,
    round: publicRound(round),
    lastResult,
    previousGame: meta.previousGame || null,
    topGame: meta.topGame || null,
    serverNow: utcNow(),
    serverNowMs: nowMs(),
    viewerInRound,
    config: {
      maxPlayers: ROLL_MAX_PLAYERS,
      minBet: ROLL_MIN_BET,
      bettingDurationMs: ROLL_BETTING_DURATION_MS,
      spinDurationMs: ROLL_SPIN_DURATION_MS,
      resultHoldMs: ROLL_RESULT_HOLD_MS,
      payoutBps: ROLL_PAYOUT_BPS,
      quickBets: [100, 250, 500, 1000, 2500],
    },
  }
}

export function getRollStateOnStore(store, userId) {
  ensureMaps(store)
  return statePayload(store, userId)
}

export function placeRollBetOnStore(store, userId, { bet, requestId = '' } = {}) {
  ensureMaps(store)
  const user = store.users[String(userId)]
  if (!user) {
    return { success: false, code: 'USER_NOT_FOUND', message: 'Пользователь не найден.' }
  }

  const stake = Math.floor(Number(bet))
  if (!Number.isInteger(stake) || stake < ROLL_MIN_BET) {
    return {
      success: false,
      code: 'INVALID_BET',
      message: `Минимальная ставка — ${ROLL_MIN_BET} монет.`,
    }
  }

  const reqKey = requestId ? `roll:bet:${userId}:${requestId}` : ''
  if (reqKey && store.events[reqKey]?.done) {
    return {
      alreadyProcessed: true,
      message: 'Ставка уже принята.',
      ...statePayload(store, userId),
      success: true,
    }
  }

  advanceRollRoundOnStore(store)
  let round = getOrCreateCurrentRound(store)

  if (round.status !== 'waiting') {
    return {
      code: 'ROUND_CLOSED',
      message: 'Ставки на этот раунд больше не принимаются.',
      ...statePayload(store, userId),
      success: false,
    }
  }

  if ((round.players || []).some((p) => Number(p.userId) === Number(userId))) {
    return {
      code: 'ALREADY_JOINED',
      message: 'Вы уже сделали ставку в этом раунде.',
      ...statePayload(store, userId),
      success: false,
    }
  }

  if ((round.players || []).length >= ROLL_MAX_PLAYERS) {
    return {
      code: 'ROUND_FULL',
      message: 'Раунд уже заполнен.',
      ...statePayload(store, userId),
      success: false,
    }
  }

  const spend = spendCoins(store, user, stake, TX_TYPE.ROLL_BET, `roll:bet:${round.id}:${userId}`, {
    referenceId: `${round.id}:${userId}`,
    description: `Ставка Roll #${round.displayId}`,
  })

  if (!spend.spent && spend.reason === 'already_granted') {
    // Recover player row if spend was recorded but join interrupted.
    if (!(round.players || []).some((p) => Number(p.userId) === Number(userId))) {
      round.players.push({
        userId: Number(userId),
        username: user.username || '',
        firstName: user.firstName || '',
        photoUrl: user.photoUrl || '',
        bet: stake,
        joinedAt: utcNow(),
      })
    }
    if (reqKey) {
      store.events[reqKey] = { eventId: reqKey, done: true, createdAt: utcNow() }
    }
    advanceRollRoundOnStore(store)
    return {
      alreadyProcessed: true,
      message: 'Ставка уже принята.',
      ...statePayload(store, userId),
      success: true,
    }
  }

  if (!spend.spent) {
    return {
      code: spend.reason === 'insufficient' ? 'INSUFFICIENT_FUNDS' : 'FORBIDDEN',
      message:
        spend.reason === 'insufficient'
          ? 'Недостаточно монет.'
          : 'Не удалось списать ставку.',
      ...statePayload(store, userId),
      success: false,
    }
  }

  round.players.push({
    userId: Number(userId),
    username: user.username || '',
    firstName: user.firstName || '',
    photoUrl: user.photoUrl || '',
    bet: stake,
    joinedAt: utcNow(),
  })
  round.pot = potOf(round)
  bumpRoundVersion(round)

  if (reqKey) {
    store.events[reqKey] = { eventId: reqKey, done: true, createdAt: utcNow() }
  }

  advanceRollRoundOnStore(store)
  round = getOrCreateCurrentRound(store)

  return {
    message: 'Ставка принята.',
    alreadyProcessed: false,
    ...statePayload(store, userId),
    success: true,
  }
}

export function getRollState(userId) {
  return withStore((store) => getRollStateOnStore(store, userId))
}

export function placeRollBet(userId, input) {
  const result = withStore((store) => placeRollBetOnStore(store, userId, input))
  // Push to all SSE clients immediately (second player visible without polling).
  queueMicrotask(() => {
    try {
      publishRollSnapshots()
    } catch (error) {
      console.warn('[roll] publish after bet failed', error)
    }
  })
  return result
}

function publishFromStore(store) {
  // Shared snapshot; clients derive viewerInRound from players + own telegramId.
  const payload = statePayload(store, null)
  const status = payload.round?.status
  let eventName = 'ROUND_UPDATED'
  if (status === 'betting') {
    eventName = 'BETTING_STARTED'
  } else if (status === 'spinning') {
    eventName = 'SPIN_STARTED'
  } else if (status === 'completed') {
    eventName = 'ROUND_FINISHED'
  }
  broadcastRollEvent(eventName, payload)
  if (eventName !== 'ROUND_UPDATED') {
    broadcastRollEvent('ROUND_UPDATED', payload)
  }
}

/** Advance + push current round snapshot to SSE subscribers. */
export function publishRollSnapshots() {
  withStore((store) => {
    advanceRollRoundOnStore(store)
    if (!getRollSseClientCount()) {
      return
    }
    publishFromStore(store)
  })
}

let tickerStarted = false

/**
 * Server-side clock: advances BETTING→SPINNING→RESULT without waiting for client polls.
 * This fixes hang at 00:00 when clients are rate-limited or idle.
 */
export function startRollTicker() {
  if (tickerStarted) {
    return
  }
  tickerStarted = true
  setInterval(() => {
    try {
      withStore((store) => {
        const result = advanceRollRoundOnStore(store)
        if (result?.changed && getRollSseClientCount()) {
          publishFromStore(store)
        }
      })
    } catch (error) {
      console.warn('[roll] ticker failed', error)
    }
  }, ROLL_TICK_MS).unref?.()
}

/** Read-only peek without advancing (tests). Prefer getRollStateOnStore in production. */
export function peekRollRoundOnStore(store) {
  ensureMaps(store)
  const id = store.rollMeta?.currentRoundId
  return id ? store.rollRounds[id] || null : null
}
