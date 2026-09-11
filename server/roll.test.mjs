import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { withStore } from './store.mjs'
import {
  ROLL_BETTING_DURATION_MS,
  ROLL_MAX_PLAYERS,
  ROLL_MIN_BET,
  ROLL_RESULT_HOLD_MS,
  ROLL_SPIN_DURATION_MS,
  advanceRollRoundOnStore,
  buildSegments,
  chancePercent,
  computeTargetAngle,
  findSegmentAtLocalDeg,
  getRollStateOnStore,
  normalizeDeg,
  peekRollRoundOnStore,
  pickWeightedWinner,
  placeRollBetOnStore,
  pointerLocalDeg,
} from './roll.mjs'
import { createUser } from './users.mjs'
import { listUserTransactions, TX_TYPE } from './wallet.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-roll-'))
  const previous = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      rmSync(dir, { recursive: true, force: true })
    })
}

function seedUser(store, telegramId, balance = 50_000, username = `u${telegramId}`) {
  createUser(store, {
    id: telegramId,
    first_name: `User${telegramId}`,
    username,
  })
  store.users[String(telegramId)].balance = balance
  return store.users[String(telegramId)]
}

test('chancePercent and segments match stake weights 900/100', () => {
  assert.equal(chancePercent(900, 1000), 90)
  assert.equal(chancePercent(100, 1000), 10)
  const segments = buildSegments([
    { userId: 1, bet: 900, username: 'a' },
    { userId: 2, bet: 100, username: 'b' },
  ])
  assert.equal(segments.length, 2)
  assert.ok(Math.abs(segments[0].sizeDeg - 324) < 0.001)
  assert.ok(Math.abs(segments[1].sizeDeg - 36) < 0.001)
  assert.equal(segments[0].chance, 90)
  assert.equal(segments[1].chance, 10)
})

test('1000 players: large stake is exactly half total weight', () => {
  const players = [{ userId: 1, bet: 5000, username: 'whale' }]
  for (let i = 0; i < 999; i += 1) {
    // 999 * ~5.005 ≈ 5000 — use floor distribution: 5000 coins among 999
    players.push({ userId: i + 2, bet: 0, username: `p${i}` })
  }
  // Distribute 5000 coins: first 5 get 1 extra among equal shares
  const base = Math.floor(5000 / 999)
  let rem = 5000 - base * 999
  for (let i = 1; i < players.length; i += 1) {
    players[i].bet = base + (rem > 0 ? 1 : 0)
    if (rem > 0) rem -= 1
  }
  const total = players.reduce((s, p) => s + p.bet, 0)
  assert.equal(total, 10_000)
  assert.equal(chancePercent(5000, total), 50)
  const segments = buildSegments(players)
  assert.equal(segments.length, 1000)
  assert.ok(Math.abs(segments[0].sizeDeg - 180) < 0.001)
  const sumDeg = segments.reduce((s, seg) => s + seg.sizeDeg, 0)
  assert.ok(Math.abs(sumDeg - 360) < 1e-6)
})

test('pickWeightedWinner respects weights', () => {
  const players = [
    { userId: 1, bet: 900 },
    { userId: 2, bet: 100 },
  ]
  assert.equal(pickWeightedWinner(players, () => 0).winnerUserId, 1)
  assert.equal(pickWeightedWinner(players, () => 899).winnerUserId, 1)
  assert.equal(pickWeightedWinner(players, () => 900).winnerUserId, 2)
  assert.equal(pickWeightedWinner(players, () => 999).winnerUserId, 2)
})

test('target angle lands inside winner segment under pointer', () => {
  const segments = buildSegments([
    { userId: 1, bet: 700, username: 'a' },
    { userId: 2, bet: 300, username: 'b' },
  ])
  for (let i = 0; i < 20; i += 1) {
    const target = computeTargetAngle(segments, 1)
    const local = pointerLocalDeg(target)
    const hit = findSegmentAtLocalDeg(segments, local)
    assert.equal(hit?.userId, 1, `local=${local} target=${target}`)
  }
  for (let i = 0; i < 20; i += 1) {
    const target = computeTargetAngle(segments, 2)
    const local = pointerLocalDeg(target)
    const hit = findSegmentAtLocalDeg(segments, local)
    assert.equal(hit?.userId, 2, `local=${local} target=${target}`)
  }
  assert.equal(normalizeDeg(370), 10)
})

test('first bet starts countdown; more players can join; double bet rejected', async () => {
  await withTempStore(async () => {
    const joined = withStore((store) => {
      seedUser(store, 101, 10_000, 'alice')
      seedUser(store, 102, 10_000, 'bob')
      seedUser(store, 103, 10_000, 'carol')
      const a = placeRollBetOnStore(store, 101, { bet: 900, requestId: 'r1' })
      assert.equal(a.success, true)
      assert.equal(a.round.status, 'betting')
      assert.ok(a.round.bettingEndsAt)
      assert.equal(store.users['101'].balance, 9100)

      const b = placeRollBetOnStore(store, 102, { bet: 100, requestId: 'r2' })
      assert.equal(b.success, true)
      assert.equal(b.round.status, 'betting')
      assert.equal(b.round.players[0].chance, 90)
      assert.equal(b.round.players[1].chance, 10)

      const c = placeRollBetOnStore(store, 103, { bet: 100, requestId: 'r3' })
      assert.equal(c.success, true)
      assert.equal(c.round.players.length, 3)

      const again = placeRollBetOnStore(store, 101, { bet: 100, requestId: 'r4' })
      assert.equal(again.success, false)
      assert.equal(again.code, 'ALREADY_JOINED')

      return peekRollRoundOnStore(store)
    })
    assert.equal(joined.players.length, 3)
  })
})

test('ROUND_FULL rejects beyond MAX_PLAYERS atomically', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      for (let i = 1; i <= 5; i += 1) {
        seedUser(store, 6000 + i, 50_000, `m${i}`)
      }
      advanceRollRoundOnStore(store)
      const round = peekRollRoundOnStore(store)
      assert.ok(round)
      round.players = []
      for (let i = 1; i <= 999; i += 1) {
        round.players.push({
          userId: 700_000 + i,
          username: `bot${i}`,
          firstName: `Bot${i}`,
          photoUrl: '',
          bet: ROLL_MIN_BET,
          joinedAt: new Date().toISOString(),
        })
      }
      round.status = 'betting'
      round.bettingStartedAt = new Date().toISOString()
      round.bettingEndsAt = new Date(Date.now() + 60_000).toISOString()
      round.pot = 999 * ROLL_MIN_BET

      const ok = placeRollBetOnStore(store, 6001, { bet: ROLL_MIN_BET, requestId: 'fill-ok' })
      assert.equal(ok.success, true)
      assert.equal(peekRollRoundOnStore(store).players.length, 1000)

      const full = placeRollBetOnStore(store, 6002, { bet: ROLL_MIN_BET, requestId: 'fill-full' })
      assert.equal(full.success, false)
      assert.equal(full.code, 'ROUND_FULL')
      assert.equal(peekRollRoundOnStore(store).players.length, 1000)
    })
  })
})

test('bet after deadline rejected; settle pays once; reload settle noop', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 201, 20_000, 'p1')
      seedUser(store, 202, 20_000, 'p2')
      placeRollBetOnStore(store, 201, { bet: 500, requestId: 'd1' })
      placeRollBetOnStore(store, 202, { bet: 500, requestId: 'd2' })
      const round = peekRollRoundOnStore(store)
      assert.equal(round.status, 'betting')

      const ends = Date.parse(round.bettingEndsAt)
      advanceRollRoundOnStore(store, ends)
      const lockedOrSpin = peekRollRoundOnStore(store)
      assert.ok(['locked', 'spinning'].includes(lockedOrSpin.status))
      assert.ok(lockedOrSpin.winnerUserId === 201 || lockedOrSpin.winnerUserId === 202)
      assert.ok(Number.isFinite(lockedOrSpin.targetAngle))
      assert.equal(
        Date.parse(lockedOrSpin.spinEndsAt) - Date.parse(lockedOrSpin.spinStartedAt),
        ROLL_SPIN_DURATION_MS,
      )

      const late = placeRollBetOnStore(store, 201, { bet: 100, requestId: 'late' })
      assert.equal(late.success, false)

      const spinning = peekRollRoundOnStore(store)
      const spinEnd = Date.parse(spinning.spinEndsAt)
      advanceRollRoundOnStore(store, spinEnd + 10)
      const finishedId = store.rollMeta.lastResultRoundId
      const finished = store.rollRounds[finishedId]
      assert.ok(finished)
      assert.equal(finished.status, 'completed')
      assert.ok(finished.settledAt)
      assert.equal(finished.payout, 1000)

      const winnerId = String(finished.winnerUserId)
      const winnerBalance = store.users[winnerId].balance
      assert.equal(winnerBalance, 20_500)

      const wins = listUserTransactions(store, Number(winnerId)).filter((t) => t.type === TX_TYPE.ROLL_WIN)
      assert.equal(wins.length, 1)

      advanceRollRoundOnStore(store, spinEnd + 10)
      const wins2 = listUserTransactions(store, Number(winnerId)).filter((t) => t.type === TX_TYPE.ROLL_WIN)
      assert.equal(wins2.length, 1)

      advanceRollRoundOnStore(store, spinEnd + ROLL_RESULT_HOLD_MS + 50)
      const next = peekRollRoundOnStore(store)
      assert.equal(next.status, 'waiting')
      assert.notEqual(next.id, finished.id)

      const state = getRollStateOnStore(store, 201)
      assert.ok(state.previousGame)
      assert.ok(state.topGame)
      assert.equal(state.previousGame.winnings, 1000)
    })
  })
})

test('solo player: first bet starts timer and can win alone', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 901, 5_000, 'solo')
      const bet = placeRollBetOnStore(store, 901, { bet: 500, requestId: 'solo1' })
      assert.equal(bet.success, true)
      assert.equal(bet.round.status, 'betting')
      assert.equal(bet.round.players.length, 1)

      const ends = Date.parse(bet.round.bettingEndsAt)
      advanceRollRoundOnStore(store, ends)
      const spinning = peekRollRoundOnStore(store)
      assert.equal(spinning.status, 'spinning')
      assert.equal(spinning.winnerUserId, 901)
      assert.equal(spinning.payout, 500)

      advanceRollRoundOnStore(store, Date.parse(spinning.spinEndsAt) + 10)
      const finished = store.rollRounds[store.rollMeta.lastResultRoundId]
      assert.equal(finished.status, 'completed')
      assert.equal(store.users['901'].balance, 5_000)
    })
  })
})

test('idempotent bet requestId does not double-charge', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 301, 5000, 'solo')
      const first = placeRollBetOnStore(store, 301, { bet: ROLL_MIN_BET, requestId: 'same' })
      assert.equal(first.success, true)
      assert.equal(store.users['301'].balance, 4900)
      const second = placeRollBetOnStore(store, 301, { bet: ROLL_MIN_BET, requestId: 'same' })
      assert.equal(second.success, true)
      assert.equal(second.alreadyProcessed, true)
      assert.equal(store.users['301'].balance, 4900)
      assert.equal(peekRollRoundOnStore(store).players.length, 1)
    })
  })
})

test('insufficient funds and invalid bet', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 401, 50, 'broke')
      const low = placeRollBetOnStore(store, 401, { bet: 99, requestId: 'x1' })
      assert.equal(low.code, 'INVALID_BET')
      const broke = placeRollBetOnStore(store, 401, { bet: ROLL_MIN_BET, requestId: 'x2' })
      assert.equal(broke.code, 'INSUFFICIENT_FUNDS')
    })
  })
})

test('config constants match plan', () => {
  assert.equal(ROLL_MAX_PLAYERS, 1000)
  assert.equal(ROLL_MIN_BET, 100)
  assert.equal(ROLL_BETTING_DURATION_MS, 20_000)
  assert.equal(ROLL_SPIN_DURATION_MS, 10_000)
})
