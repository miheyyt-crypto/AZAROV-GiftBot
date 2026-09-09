import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createGiveawayOnStore,
  deleteGiveawayOnStore,
  finalizeDueGiveawaysOnStore,
  finalizeGiveawayOnStore,
  getPublicGiveawayOnStore,
  listPublicGiveawaysOnStore,
  markPrizeDeliveredOnStore,
  participateOnStore,
  pickRandomWinners,
  stopGiveawayScheduler,
  updateGiveawayOnStore,
  validateGiveawayCreateInput,
} from './giveaways.mjs'
import { createEmptyStore, withStore } from './store.mjs'
import { createUser } from './users.mjs'
import { hasEvent, listUserTransactions, TX_TYPE } from './wallet.mjs'
import { NOTIFICATION_TYPE } from './notifications.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-giveaways-'))
  const previous = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir
  stopGiveawayScheduler()

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      stopGiveawayScheduler()
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      rmSync(dir, { recursive: true, force: true })
    })
}

function seedUser(store, telegramId, extras = {}) {
  createUser(store, {
    id: telegramId,
    first_name: extras.firstName || `User${telegramId}`,
    username: extras.username || `u${telegramId}`,
    photo_url: extras.photoUrl || '',
  })
}

function futureIso(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 3_600_000).toISOString()
}

function pastIso(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
}

function validCreateBody(overrides = {}) {
  return {
    title: 'Розыгрыш 10 000 монет',
    description: 'Участвуй и выиграй.',
    image: '/uploads/giveaways/demo.jpg',
    prizeType: 'coins',
    prizeAmount: 10_000,
    prizeText: null,
    winnersCount: 2,
    startAt: pastIso(1),
    endAt: futureIso(2),
    ...overrides,
  }
}

test('validateGiveawayCreateInput rejects bad dates and prize', () => {
  assert.equal(validateGiveawayCreateInput(null).ok, false)
  assert.equal(
    validateGiveawayCreateInput(
      validCreateBody({ endAt: pastIso(1), startAt: pastIso(2) }),
    ).code,
    'ALREADY_ENDED',
  )
  assert.equal(
    validateGiveawayCreateInput(validCreateBody({ prizeAmount: -5 })).ok,
    false,
  )
  assert.equal(
    validateGiveawayCreateInput(validCreateBody({ winnersCount: 0 })).ok,
    false,
  )
  assert.equal(
    validateGiveawayCreateInput(
      validCreateBody({
        prizeType: 'text',
        prizeAmount: null,
        prizeText: '',
      }),
    ).ok,
    false,
  )
})

test('pickRandomWinners uses unique ids and caps at pool size', () => {
  const winners = pickRandomWinners([1, 2, 2, 3], 10)
  assert.equal(winners.length, 3)
  assert.equal(new Set(winners).size, 3)
  assert.deepEqual(pickRandomWinners([], 5), [])
})

test('create + list active giveaway', async () => {
  await withTempStore(async () => {
    const created = withStore((store) => createGiveawayOnStore(store, validCreateBody()))
    assert.equal(created.success, true)
    assert.equal(created.giveaway.status, 'active')

    const listed = withStore((store) => listPublicGiveawaysOnStore(store))
    assert.equal(listed.length, 1)
    assert.equal(listed[0].id, created.giveaway.id)
    assert.equal(listed[0].title, 'Розыгрыш 10 000 монет')
  })
})

test('participate once; second call is idempotent', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 101)
      return createGiveawayOnStore(store, validCreateBody()).giveaway.id
    })

    const first = withStore((store) => participateOnStore(store, giveawayId, 101))
    assert.equal(first.success, true)
    assert.equal(first.alreadyParticipating, false)
    assert.equal(first.participantsCount, 1)

    const second = withStore((store) => participateOnStore(store, giveawayId, 101))
    assert.equal(second.success, true)
    assert.equal(second.alreadyParticipating, true)
    assert.equal(second.participantsCount, 1)
  })
})

test('unknown giveaway participate returns NOT_FOUND', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 102)
      return true
    })
    const result = withStore((store) => participateOnStore(store, 'gw_deadbeefdeadbeef', 102))
    assert.equal(result.success, false)
    assert.equal(result.code, 'NOT_FOUND')
  })
})

test('cannot participate before startAt', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 103)
      return createGiveawayOnStore(
        store,
        validCreateBody({ startAt: futureIso(1), endAt: futureIso(3) }),
      ).giveaway.id
    })
    const result = withStore((store) => participateOnStore(store, giveawayId, 103))
    assert.equal(result.success, false)
    assert.equal(result.code, 'NOT_STARTED')
  })
})

test('cannot participate after end; auto-finalize happens', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 104)
      const created = createGiveawayOnStore(store, validCreateBody())
      // Force expired endAt after create validation.
      store.giveaways[created.giveaway.id].endAt = pastIso(0.1)
      return created.giveaway.id
    })

    const result = withStore((store) => participateOnStore(store, giveawayId, 104))
    assert.equal(result.success, false)
    assert.equal(result.code, 'ENDED')

    const row = withStore((store) => store.giveaways[giveawayId])
    assert.equal(row.status, 'completed')
  })
})

test('finalize picks winnersCount, rewards coins once, notifications once', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      for (const id of [201, 202, 203, 204]) {
        seedUser(store, id)
      }
      const created = createGiveawayOnStore(
        store,
        validCreateBody({ winnersCount: 2, prizeAmount: 10_000 }),
      )
      for (const id of [201, 202, 203, 204]) {
        participateOnStore(store, created.giveaway.id, id)
      }
      store.giveaways[created.giveaway.id].endAt = pastIso(0.01)
      return created.giveaway.id
    })

    const first = withStore((store) => finalizeGiveawayOnStore(store, giveawayId))
    assert.equal(first.success, true)
    assert.equal(first.alreadyCompleted, false)
    assert.equal(first.giveaway.winnerIds.length, 2)
    assert.equal(new Set(first.giveaway.winnerIds).size, 2)

    const balancesAfterFirst = withStore((store) =>
      first.giveaway.winnerIds.map((id) => Number(store.users[String(id)].balance)),
    )
    assert.deepEqual(balancesAfterFirst, [10_000, 10_000])

    const notifications = withStore((store) =>
      Object.values(store.notifications).filter(
        (row) => row.type === NOTIFICATION_TYPE.GIVEAWAY_WON,
      ),
    )
    assert.equal(notifications.length, 2)

    const ledgerCount = withStore((store) => {
      let count = 0
      for (const id of first.giveaway.winnerIds) {
        count += listUserTransactions(store, id).filter((tx) => tx.type === TX_TYPE.GIVEAWAY_REWARD)
          .length
      }
      return count
    })
    assert.equal(ledgerCount, 2)

    const winnersSnapshot = [...first.giveaway.winnerIds]

    const second = withStore((store) => finalizeGiveawayOnStore(store, giveawayId))
    assert.equal(second.success, true)
    assert.equal(second.alreadyCompleted, true)
    assert.deepEqual(second.giveaway.winnerIds, winnersSnapshot)

    const balancesAfterSecond = withStore((store) =>
      winnersSnapshot.map((id) => Number(store.users[String(id)].balance)),
    )
    assert.deepEqual(balancesAfterSecond, [10_000, 10_000])

    const notificationsAfter = withStore((store) =>
      Object.values(store.notifications).filter(
        (row) => row.type === NOTIFICATION_TYPE.GIVEAWAY_WON,
      ),
    )
    assert.equal(notificationsAfter.length, 2)

    withStore((store) => {
      for (const id of winnersSnapshot) {
        assert.equal(hasEvent(store, `giveaway:${giveawayId}:winner:${id}`), true)
      }
      return true
    })
  })
})

test('finalize with fewer participants than winnersCount picks all', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 301)
      const created = createGiveawayOnStore(store, validCreateBody({ winnersCount: 5 }))
      participateOnStore(store, created.giveaway.id, 301)
      store.giveaways[created.giveaway.id].endAt = pastIso(0.01)
      return created.giveaway.id
    })

    const result = withStore((store) => finalizeGiveawayOnStore(store, giveawayId))
    assert.equal(result.giveaway.winnerIds.length, 1)
    assert.equal(result.giveaway.winnerIds[0], 301)
  })
})

test('finalizeDueGiveaways completes expired actives', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 401)
      const created = createGiveawayOnStore(store, validCreateBody({ winnersCount: 1 }))
      participateOnStore(store, created.giveaway.id, 401)
      store.giveaways[created.giveaway.id].endAt = pastIso(0.01)
      return true
    })

    const result = withStore((store) => finalizeDueGiveawaysOnStore(store))
    assert.equal(result.finalized.length, 1)
    assert.equal(result.finalized[0].status, 'completed')
  })
})

test('completed giveaway cannot be patched or deleted', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 501)
      const created = createGiveawayOnStore(store, validCreateBody({ winnersCount: 1 }))
      participateOnStore(store, created.giveaway.id, 501)
      store.giveaways[created.giveaway.id].endAt = pastIso(0.01)
      finalizeGiveawayOnStore(store, created.giveaway.id)
      return created.giveaway.id
    })

    const patched = withStore((store) =>
      updateGiveawayOnStore(store, giveawayId, { title: 'Хак' }),
    )
    assert.equal(patched.success, false)
    assert.equal(patched.code, 'IMMUTABLE')

    const deleted = withStore((store) => deleteGiveawayOnStore(store, giveawayId))
    assert.equal(deleted.success, false)
    assert.equal(deleted.code, 'IMMUTABLE')
  })
})

test('active giveaway with participants cannot change prize', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 601)
      const created = createGiveawayOnStore(store, validCreateBody())
      participateOnStore(store, created.giveaway.id, 601)
      return created.giveaway.id
    })

    const patched = withStore((store) =>
      updateGiveawayOnStore(store, giveawayId, { prizeAmount: 1 }),
    )
    assert.equal(patched.success, false)
    assert.equal(patched.code, 'HAS_PARTICIPANTS')
  })
})

test('cannot delete active giveaway with participants', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 701)
      const created = createGiveawayOnStore(store, validCreateBody())
      participateOnStore(store, created.giveaway.id, 701)
      return created.giveaway.id
    })
    const deleted = withStore((store) => deleteGiveawayOnStore(store, giveawayId))
    assert.equal(deleted.success, false)
    assert.equal(deleted.code, 'HAS_PARTICIPANTS')
  })
})

test('can delete active giveaway with zero participants', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => createGiveawayOnStore(store, validCreateBody()).giveaway.id)
    const deleted = withStore((store) => deleteGiveawayOnStore(store, giveawayId))
    assert.equal(deleted.success, true)
  })
})

test('public completed giveaway exposes winners without relying on client', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 801, { username: 'winner_one' })
      const created = createGiveawayOnStore(store, validCreateBody({ winnersCount: 1 }))
      participateOnStore(store, created.giveaway.id, 801)
      store.giveaways[created.giveaway.id].endAt = pastIso(0.01)
      finalizeGiveawayOnStore(store, created.giveaway.id)
      return created.giveaway.id
    })

    const publicRow = withStore((store) =>
      getPublicGiveawayOnStore(store, giveawayId, { userId: 801 }),
    )
    assert.equal(publicRow.status, 'completed')
    assert.equal(publicRow.winners.length, 1)
    assert.equal(publicRow.winners[0].username, 'winner_one')
    assert.equal(publicRow.isParticipating, true)
    assert.equal('winnerIds' in publicRow, false)
  })
})

test('store migration creates giveaways maps at v8', () => {
  const store = createEmptyStore()
  assert.equal(store.version, 16)
  assert.ok(store.giveaways)
  assert.ok(store.giveawayParticipants)
  assert.ok(store.communityAccessRequests)
})

test('text prize does not grant coins', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 901)
      const created = createGiveawayOnStore(
        store,
        validCreateBody({
          prizeType: 'text',
          prizeAmount: null,
          prizeText: 'Telegram Premium 12 месяцев',
          winnersCount: 1,
        }),
      )
      participateOnStore(store, created.giveaway.id, 901)
      store.giveaways[created.giveaway.id].endAt = pastIso(0.01)
      return created.giveaway.id
    })

    withStore((store) => finalizeGiveawayOnStore(store, giveawayId))
    const balance = withStore((store) => Number(store.users['901'].balance))
    assert.equal(balance, 0)
    const row = withStore((store) => store.giveaways[giveawayId])
    assert.equal(row.prizeType, 'custom')
    assert.equal(row.prizeDeliveryStatus, 'pending')
    const notifs = withStore((store) => Object.values(store.notifications))
    assert.equal(notifs.length, 1)
    assert.match(notifs[0].message, /Telegram Premium/)
  })
})

test('custom prize stores winnersInfo and can be marked delivered', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 911, { username: 'winner_custom', firstName: 'Winner' })
      const created = createGiveawayOnStore(
        store,
        validCreateBody({
          prizeType: 'custom',
          prizeAmount: null,
          prizeText: '5 000 рублей',
          winnersCount: 1,
        }),
      )
      participateOnStore(store, created.giveaway.id, 911)
      store.giveaways[created.giveaway.id].endAt = pastIso(0.01)
      return created.giveaway.id
    })

    const finalized = withStore((store) => finalizeGiveawayOnStore(store, giveawayId))
    assert.equal(finalized.giveaway.prizeDeliveryStatus, 'pending')
    assert.equal(finalized.giveaway.winnerTelegramId, 911)
    assert.equal(finalized.giveaway.winnerUsername, 'winner_custom')
    assert.equal(finalized.giveaway.winnerFirstName, 'Winner')
    assert.ok(finalized.telegramJobs.some((job) => job.kind === 'admin'))

    const balance = withStore((store) => Number(store.users['911'].balance))
    assert.equal(balance, 0)

    const marked = withStore((store) => markPrizeDeliveredOnStore(store, giveawayId))
    assert.equal(marked.success, true)
    assert.equal(marked.giveaway.prizeDeliveryStatus, 'delivered')

    const again = withStore((store) => markPrizeDeliveredOnStore(store, giveawayId))
    assert.equal(again.alreadyDelivered, true)
  })
})

test('winner without username still stores telegramId', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      createUser(store, { id: 921, first_name: 'NoNick', username: '' })
      const created = createGiveawayOnStore(
        store,
        validCreateBody({
          prizeType: 'custom',
          prizeAmount: null,
          prizeText: 'NFT подарок',
          winnersCount: 1,
        }),
      )
      participateOnStore(store, created.giveaway.id, 921)
      store.giveaways[created.giveaway.id].endAt = pastIso(0.01)
      return created.giveaway.id
    })

    const finalized = withStore((store) => finalizeGiveawayOnStore(store, giveawayId))
    assert.equal(finalized.giveaway.winnerTelegramId, 921)
    assert.equal(finalized.giveaway.winnerUsername, null)
    assert.equal(finalized.giveaway.winnerFirstName, 'NoNick')
  })
})

test('coin giveaway marks delivery as delivered and grants coins', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 931)
      const created = createGiveawayOnStore(
        store,
        validCreateBody({ winnersCount: 1, prizeAmount: 5000 }),
      )
      participateOnStore(store, created.giveaway.id, 931)
      store.giveaways[created.giveaway.id].endAt = pastIso(0.01)
      return created.giveaway.id
    })
    const finalized = withStore((store) => finalizeGiveawayOnStore(store, giveawayId))
    assert.equal(finalized.giveaway.prizeDeliveryStatus, 'delivered')
    assert.equal(withStore((store) => Number(store.users['931'].balance)), 5000)
  })
})

test('create giveaway without imageFileId stores null', async () => {
  await withTempStore(async () => {
    const created = withStore((store) => createGiveawayOnStore(store, validCreateBody()))
    assert.equal(created.success, true)
    assert.equal(created.giveaway.imageFileId, null)
    const row = withStore((store) => store.giveaways[created.giveaway.id])
    assert.equal(row.imageFileId, null)
  })
})

test('create giveaway with imageFileId persists and survives finalize', async () => {
  await withTempStore(async () => {
    const fileId = 'AgACAgIAAxkBAAITestFileId1234567890'
    const giveawayId = withStore((store) => {
      seedUser(store, 941)
      const created = createGiveawayOnStore(
        store,
        validCreateBody({ imageFileId: fileId, winnersCount: 1 }),
      )
      assert.equal(created.success, true)
      assert.equal(created.giveaway.imageFileId, fileId)
      participateOnStore(store, created.giveaway.id, 941)
      store.giveaways[created.giveaway.id].endAt = pastIso(0.01)
      return created.giveaway.id
    })

    const finalized = withStore((store) => finalizeGiveawayOnStore(store, giveawayId))
    assert.equal(finalized.success, true)
    assert.equal(finalized.giveaway.imageFileId, fileId)
    const row = withStore((store) => store.giveaways[giveawayId])
    assert.equal(row.imageFileId, fileId)
  })
})

test('legacy giveaway without imageFileId field reads as null in public API', async () => {
  await withTempStore(async () => {
    const publicRow = withStore((store) => {
      const created = createGiveawayOnStore(store, validCreateBody())
      delete store.giveaways[created.giveaway.id].imageFileId
      return listPublicGiveawaysOnStore(store).find((g) => g.id === created.giveaway.id)
    })
    assert.ok(publicRow)
    assert.equal(publicRow.imageFileId, null)
  })
})

test('validateGiveawayCreateInput rejects oversized imageFileId', () => {
  const result = validateGiveawayCreateInput(
    validCreateBody({ imageFileId: 'x'.repeat(600) }),
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_IMAGE_FILE_ID')
})
