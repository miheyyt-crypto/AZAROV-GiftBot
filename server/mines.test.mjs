import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  cashoutMinesOnStore,
  minesMultiplierBps,
  minesPotentialWin,
  MINES_MIN_BET,
  revealMinesCellOnStore,
  startMinesGameOnStore,
} from './mines.mjs'
import { createEmptyStore, withStore } from './store.mjs'
import { createUser } from './users.mjs'
import { TX_TYPE, listUserTransactions } from './wallet.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-mines-'))
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

test('minesMultiplierBps grows with safe opens and more mines', () => {
  const low = minesMultiplierBps(1, 3)
  const high = minesMultiplierBps(1, 20)
  assert.ok(high > low)
  assert.ok(minesMultiplierBps(3, 5) > minesMultiplierBps(1, 5))
  assert.equal(minesMultiplierBps(0, 5), 10_000)
})

test('start rejects bet below minimum and insufficient funds', async () => {
  await withTempStore(async () => {
    const lowBet = withStore((store) => {
      seedUser(store, 1, 5000)
      return startMinesGameOnStore(store, 1, {
        bet: 99,
        mineCount: 5,
        requestId: 'req-mines-low-bet',
      })
    })
    assert.equal(lowBet.success, false)
    assert.equal(lowBet.code, 'INVALID_BET')

    const broke = withStore((store) => {
      seedUser(store, 2, 50)
      return startMinesGameOnStore(store, 2, {
        bet: MINES_MIN_BET,
        mineCount: 5,
        requestId: 'req-mines-broke',
      })
    })
    assert.equal(broke.success, false)
    assert.equal(broke.code, 'INSUFFICIENT_FUNDS')
  })
})

test('start spends bet once and is idempotent by requestId', async () => {
  await withTempStore(async () => {
    const first = withStore((store) => {
      seedUser(store, 3, 1000)
      return startMinesGameOnStore(store, 3, {
        bet: 100,
        mineCount: 5,
        requestId: 'req-mines-start-1',
      })
    })
    assert.equal(first.success, true)
    assert.equal(first.game.status, 'playing')
    assert.equal(first.game.mineIndices, null)

    const balanceAfter = withStore((store) => store.users['3'].balance)
    assert.equal(balanceAfter, 900)

    const second = withStore((store) =>
      startMinesGameOnStore(store, 3, {
        bet: 100,
        mineCount: 5,
        requestId: 'req-mines-start-1',
      }),
    )
    assert.equal(second.success, true)
    assert.equal(second.alreadyProcessed, true)
    assert.equal(second.game.id, first.game.id)
    assert.equal(withStore((store) => store.users['3'].balance), 900)
  })
})

test('cannot start second game while one is active', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 4, 5000)
      startMinesGameOnStore(store, 4, {
        bet: 100,
        mineCount: 3,
        requestId: 'req-mines-active-a',
      })
    })
    const blocked = withStore((store) =>
      startMinesGameOnStore(store, 4, {
        bet: 100,
        mineCount: 3,
        requestId: 'req-mines-active-b',
      }),
    )
    assert.equal(blocked.success, false)
    assert.equal(blocked.code, 'GAME_ACTIVE')
  })
})

test('mine hit loses stake; cashout credits once', async () => {
  await withTempStore(async () => {
    const started = withStore((store) => {
      seedUser(store, 5, 1000)
      return startMinesGameOnStore(store, 5, {
        bet: 100,
        mineCount: 24,
        requestId: 'req-mine-hit',
      })
    })
    assert.equal(started.success, true)
    const gameId = started.game.id

    // Force a known mine layout: only cell 0 is safe.
    withStore((store) => {
      store.minesGames[gameId].mineIndices = Array.from({ length: 24 }, (_, i) => i + 1)
      store.minesGames[gameId].revealed = []
    })

    const hit = withStore((store) =>
      revealMinesCellOnStore(store, 5, {
        gameId,
        cellIndex: 1,
        requestId: 'req-reveal-mine',
      }),
    )
    assert.equal(hit.success, true)
    assert.equal(hit.hitMine, true)
    assert.equal(hit.game.status, 'lost')
    assert.ok(Array.isArray(hit.game.mineIndices))
    assert.equal(withStore((store) => store.users['5'].balance), 900)

    const cashoutLost = withStore((store) =>
      cashoutMinesOnStore(store, 5, { gameId, requestId: 'req-cash-lost' }),
    )
    assert.equal(cashoutLost.success, false)
  })
})

test('safe reveal then cashout pays once; double cashout is idempotent', async () => {
  await withTempStore(async () => {
    const started = withStore((store) => {
      seedUser(store, 6, 1000)
      return startMinesGameOnStore(store, 6, {
        bet: 100,
        mineCount: 5,
        requestId: 'req-cash-start',
      })
    })
    const gameId = started.game.id

    withStore((store) => {
      // Mines on 20..24, safe 0..19
      store.minesGames[gameId].mineIndices = [20, 21, 22, 23, 24]
      store.minesGames[gameId].revealed = []
    })

    const safe = withStore((store) =>
      revealMinesCellOnStore(store, 6, {
        gameId,
        cellIndex: 0,
        requestId: 'req-safe-0',
      }),
    )
    assert.equal(safe.success, true)
    assert.equal(safe.hitMine, false)
    assert.equal(safe.game.status, 'playing')
    assert.ok(safe.game.potentialWin >= 100)
    assert.equal(safe.game.canCashout, true)

    const win = withStore((store) =>
      cashoutMinesOnStore(store, 6, { gameId, requestId: 'req-cash-1' }),
    )
    assert.equal(win.success, true)
    assert.equal(win.game.status, 'won')
    const payout = win.game.payout
    assert.ok(payout >= 100)

    const balance = withStore((store) => store.users['6'].balance)
    assert.equal(balance, 900 + payout)

    const again = withStore((store) =>
      cashoutMinesOnStore(store, 6, { gameId, requestId: 'req-cash-2' }),
    )
    assert.equal(again.success, true)
    assert.equal(again.alreadyProcessed, true)
    assert.equal(withStore((store) => store.users['6'].balance), 900 + payout)

    const txs = withStore((store) => listUserTransactions(store, 6))
    const wins = txs.filter((tx) => tx.type === TX_TYPE.MINES_WIN)
    assert.equal(wins.length, 1)
  })
})

test('minesPotentialWin uses integer math', () => {
  assert.equal(minesPotentialWin(100, 0, 5), 100)
  assert.ok(minesPotentialWin(100, 2, 5) >= minesPotentialWin(100, 1, 5))
})

test('createEmptyStore includes minesGames at v10', () => {
  const store = createEmptyStore()
  assert.equal(store.version, 16)
  assert.ok(store.minesGames)
})
