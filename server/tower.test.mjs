import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createEmptyStore, withStore } from './store.mjs'
import {
  cashoutTowerOnStore,
  getTowerMultiplier,
  pickTowerCellOnStore,
  startTowerGameOnStore,
  TOWER_MAX_FLOORS,
  TOWER_MIN_BET,
  towerMultiplierBps,
  towerPotentialWin,
} from './tower.mjs'
import { createUser } from './users.mjs'
import { listUserTransactions, TX_TYPE } from './wallet.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-tower-'))
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

function seedUser(store, telegramId, balance = 10_000) {
  createUser(store, {
    id: telegramId,
    first_name: `User${telegramId}`,
    username: `u${telegramId}`,
  })
  store.users[String(telegramId)].balance = balance
  return store.users[String(telegramId)]
}

test('tower multipliers match reference table (no exponential blow-up)', () => {
  const expected = [1.0, 1.44, 2.16, 3.24, 4.86, 7.29, 10.93, 16.4, 24.6, 36.91, 55.36]
  assert.equal(towerMultiplierBps(0), 10_000)
  for (let floor = 1; floor <= expected.length; floor += 1) {
    assert.equal(getTowerMultiplier(floor), expected[floor - 1])
  }
  assert.equal(getTowerMultiplier(11), 55.36)
  assert.ok(getTowerMultiplier(11) < 100)
  assert.equal(towerPotentialWin(100, 1), 100)
  assert.equal(towerPotentialWin(100, 5), 486)
  assert.equal(towerPotentialWin(1000, 5), 4860)
  assert.equal(towerPotentialWin(100, 11), 5536)
})

test('start rejects bet below minimum and insufficient funds', async () => {
  await withTempStore(async () => {
    const lowBet = withStore((store) => {
      seedUser(store, 1, 5000)
      return startTowerGameOnStore(store, 1, { bet: 99, requestId: 'req-tower-low' })
    })
    assert.equal(lowBet.success, false)
    assert.equal(lowBet.code, 'INVALID_BET')

    const broke = withStore((store) => {
      seedUser(store, 2, 50)
      return startTowerGameOnStore(store, 2, { bet: TOWER_MIN_BET, requestId: 'req-tower-broke' })
    })
    assert.equal(broke.success, false)
    assert.equal(broke.code, 'INSUFFICIENT_FUNDS')
  })
})

test('start spends bet once and is idempotent by requestId', async () => {
  await withTempStore(async () => {
    const first = withStore((store) => {
      seedUser(store, 3, 1000)
      return startTowerGameOnStore(store, 3, { bet: 100, requestId: 'req-tower-start-1' })
    })
    assert.equal(first.success, true)
    assert.equal(first.game.status, 'playing')
    assert.equal(first.game.safeCells, null)
    assert.equal(first.game.currentFloor, 1)

    const balanceAfter = withStore((store) => store.users['3'].balance)
    assert.equal(balanceAfter, 900)

    const second = withStore((store) =>
      startTowerGameOnStore(store, 3, { bet: 100, requestId: 'req-tower-start-1' }),
    )
    assert.equal(second.success, true)
    assert.equal(second.alreadyProcessed, true)
    assert.equal(withStore((store) => store.users['3'].balance), 900)
  })
})

test('safe pick advances floor; danger ends game; cashout pays once', async () => {
  await withTempStore(async () => {
    const started = withStore((store) => {
      seedUser(store, 4, 5000)
      const result = startTowerGameOnStore(store, 4, { bet: 100, requestId: 'req-tower-play' })
      // Force known safe cell for floor 1.
      store.towerGames[result.game.id].safeCells = Array.from({ length: TOWER_MAX_FLOORS }, () => 1)
      return result
    })
    const gameId = started.game.id

    const wrong = withStore((store) =>
      pickTowerCellOnStore(store, 4, {
        gameId,
        floor: 1,
        cellIndex: 0,
        requestId: 'pick-bad',
      }),
    )
    assert.equal(wrong.success, true)
    assert.equal(wrong.hitDanger, true)
    assert.equal(wrong.game.status, 'lost')
    assert.equal(withStore((store) => store.users['4'].balance), 4900)

    const afterLost = withStore((store) =>
      pickTowerCellOnStore(store, 4, {
        gameId,
        floor: 1,
        cellIndex: 1,
        requestId: 'pick-after-lost',
      }),
    )
    assert.equal(afterLost.success, false)
    assert.equal(afterLost.code, 'GAME_FINISHED')
  })

  await withTempStore(async () => {
    const started = withStore((store) => {
      seedUser(store, 5, 5000)
      const result = startTowerGameOnStore(store, 5, { bet: 100, requestId: 'req-tower-win' })
      store.towerGames[result.game.id].safeCells = Array.from({ length: TOWER_MAX_FLOORS }, () => 2)
      return result
    })
    const gameId = started.game.id

    const ok = withStore((store) =>
      pickTowerCellOnStore(store, 5, {
        gameId,
        floor: 1,
        cellIndex: 2,
        requestId: 'pick-ok',
      }),
    )
    assert.equal(ok.hitDanger, false)
    assert.equal(ok.game.floorsCleared, 1)
    assert.equal(ok.game.currentFloor, 2)
    assert.equal(ok.game.canCashout, true)
    assert.equal(ok.game.potentialWin, 100)
    assert.equal(ok.game.multiplier, 1.0)

    const wrongFloor = withStore((store) =>
      pickTowerCellOnStore(store, 5, {
        gameId,
        floor: 1,
        cellIndex: 2,
        requestId: 'pick-old-floor',
      }),
    )
    assert.equal(wrongFloor.success, false)
    assert.equal(wrongFloor.code, 'WRONG_FLOOR')

    const cash1 = withStore((store) =>
      cashoutTowerOnStore(store, 5, { gameId, requestId: 'cash-1' }),
    )
    assert.equal(cash1.success, true)
    assert.equal(cash1.game.status, 'won')
    assert.equal(cash1.game.payout, 100)
    assert.equal(withStore((store) => store.users['5'].balance), 5000)

    const cash2 = withStore((store) =>
      cashoutTowerOnStore(store, 5, { gameId, requestId: 'cash-2' }),
    )
    assert.equal(cash2.alreadyProcessed, true)
    assert.equal(withStore((store) => store.users['5'].balance), 5000)

    const wins = withStore((store) =>
      listUserTransactions(store, 5).filter((tx) => tx.type === TX_TYPE.TOWER_WIN),
    )
    assert.equal(wins.length, 1)
  })
})

test('clearing max floors auto-cashes out', async () => {
  await withTempStore(async () => {
    const started = withStore((store) => {
      seedUser(store, 6, 50_000)
      const result = startTowerGameOnStore(store, 6, { bet: 100, requestId: 'req-tower-top' })
      store.towerGames[result.game.id].safeCells = Array.from({ length: TOWER_MAX_FLOORS }, () => 0)
      return result
    })
    const gameId = started.game.id

    let last = null
    for (let floor = 1; floor <= TOWER_MAX_FLOORS; floor += 1) {
      last = withStore((store) =>
        pickTowerCellOnStore(store, 6, {
          gameId,
          floor,
          cellIndex: 0,
          requestId: `pick-top-${floor}`,
        }),
      )
      assert.equal(last.success, true)
      if (floor < TOWER_MAX_FLOORS) {
        assert.equal(last.hitDanger, false)
        assert.equal(last.game.status, 'playing')
      }
    }
    assert.equal(last.game.status, 'won')
    assert.equal(last.game.floorsCleared, TOWER_MAX_FLOORS)
    assert.equal(last.game.payout, 5536)
    assert.equal(last.game.multiplier, 55.36)
  })
})

test('store version includes towerGames', () => {
  const store = createEmptyStore()
  assert.equal(store.version, 18)
  assert.ok(store.towerGames)
})
