import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID } from './constants.mjs'
import {
  checkGiveawayEligibility,
  resolveGiveawayEligibility,
} from './giveaway-eligibility.mjs'
import {
  createGiveawayOnStore,
  getPublicGiveawayOnStore,
  participateOnStore,
  stopGiveawayScheduler,
  validateGiveawayCreateInput,
} from './giveaways.mjs'
import { createUser } from './users.mjs'
import { withStore } from './store.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-gw-elig-'))
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
    photo_url: '',
  })
  const user = store.users[String(telegramId)]
  if (Array.isArray(extras.completedTasks)) {
    user.completedTasks = [...extras.completedTasks]
  }
  return user
}

function futureIso(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 3_600_000).toISOString()
}

function pastIso(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
}

function validCreateBody(overrides = {}) {
  return {
    title: 'Eligibility test',
    description: 'test',
    image: '/uploads/giveaways/demo.jpg',
    prizeType: 'coins',
    prizeAmount: 100,
    prizeText: null,
    winnersCount: 1,
    startAt: pastIso(1),
    endAt: futureIso(2),
    ...overrides,
  }
}

test('resolveGiveawayEligibility defaults missing field to all', () => {
  assert.equal(resolveGiveawayEligibility({}), 'all')
  assert.equal(resolveGiveawayEligibility({ eligibility: null }), 'all')
  assert.equal(resolveGiveawayEligibility({ eligibility: '' }), 'all')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'category_a' }), 'category_a')
  assert.equal(resolveGiveawayEligibility('category_b'), 'category_b')
})

test('checkGiveawayEligibility all / category A / category B', () => {
  const userEmpty = { completedTasks: [] }
  const userA = { completedTasks: [KICK_CONNECT_TASK_ID] }
  const userB = { completedTasks: [KICK_FOLLOW_TASK_ID] }

  assert.equal(checkGiveawayEligibility(userEmpty, { eligibility: 'all' }).eligible, true)
  assert.equal(checkGiveawayEligibility(userEmpty, { eligibility: 'category_a' }).eligible, false)
  assert.equal(
    checkGiveawayEligibility(userEmpty, { eligibility: 'category_a' }).requirement,
    'category_a',
  )
  assert.equal(checkGiveawayEligibility(userA, { eligibility: 'category_a' }).eligible, true)
  assert.equal(checkGiveawayEligibility(userEmpty, { eligibility: 'category_b' }).eligible, false)
  assert.equal(checkGiveawayEligibility(userB, { eligibility: 'category_b' }).eligible, true)
})

test('createGiveaway stores eligibility; legacy missing reads as all', async () => {
  await withTempStore(async () => {
    const created = withStore((store) =>
      createGiveawayOnStore(store, validCreateBody({ eligibility: 'category_a' })),
    )
    assert.equal(created.success, true)
    assert.equal(created.giveaway.eligibility, 'category_a')

    const defaulted = withStore((store) => createGiveawayOnStore(store, validCreateBody()))
    assert.equal(defaulted.giveaway.eligibility, 'all')

    const legacyPublic = withStore((store) => {
      const id = createGiveawayOnStore(store, validCreateBody()).giveaway.id
      delete store.giveaways[id].eligibility
      return getPublicGiveawayOnStore(store, id)
    })
    assert.equal(legacyPublic.eligibility, 'all')
  })
})

test('validateGiveawayCreateInput rejects unknown eligibility', () => {
  assert.equal(
    validateGiveawayCreateInput(validCreateBody({ eligibility: 'vip' })).code,
    'INVALID_ELIGIBILITY',
  )
})

test('participate: all allows any user', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1001)
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'all' })).giveaway.id
    })
    const result = withStore((store) => participateOnStore(store, giveawayId, 1001))
    assert.equal(result.success, true)
    assert.equal(result.participating, true)
  })
})

test('participate: category_a denies then allows after task complete', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1002)
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'category_a' }))
        .giveaway.id
    })

    const denied = withStore((store) => participateOnStore(store, giveawayId, 1002))
    assert.equal(denied.success, false)
    assert.equal(denied.code, 'GIVEAWAY_NOT_ELIGIBLE')
    assert.equal(denied.requirement, 'category_a')

    const allowed = withStore((store) => {
      store.users['1002'].completedTasks = [KICK_CONNECT_TASK_ID]
      return participateOnStore(store, giveawayId, 1002)
    })
    assert.equal(allowed.success, true)
    assert.equal(allowed.participating, true)
  })
})

test('participate: category_b denies without follow task', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1003, { completedTasks: [KICK_CONNECT_TASK_ID] })
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'category_b' }))
        .giveaway.id
    })

    const denied = withStore((store) => participateOnStore(store, giveawayId, 1003))
    assert.equal(denied.success, false)
    assert.equal(denied.code, 'GIVEAWAY_NOT_ELIGIBLE')
    assert.equal(denied.requirement, 'category_b')

    const allowed = withStore((store) => {
      store.users['1003'].completedTasks = [KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID]
      return participateOnStore(store, giveawayId, 1003)
    })
    assert.equal(allowed.success, true)
  })
})

test('participate: category_b succeeds when follow already completed', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1004, { completedTasks: [KICK_FOLLOW_TASK_ID] })
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'category_b' }))
        .giveaway.id
    })
    const result = withStore((store) => participateOnStore(store, giveawayId, 1004))
    assert.equal(result.success, true)
  })
})

test('legacy giveaway without eligibility field allows join as all', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1005)
      const created = createGiveawayOnStore(store, validCreateBody())
      delete store.giveaways[created.giveaway.id].eligibility
      return created.giveaway.id
    })
    const result = withStore((store) => participateOnStore(store, giveawayId, 1005))
    assert.equal(result.success, true)
  })
})

test('security: ineligible user cannot join via store participate API', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1006)
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'category_a' }))
        .giveaway.id
    })
    const result = withStore((store) => participateOnStore(store, giveawayId, 1006))
    assert.equal(result.success, false)
    assert.equal(result.code, 'GIVEAWAY_NOT_ELIGIBLE')
    withStore((store) => {
      assert.equal(Object.keys(store.giveawayParticipants || {}).length, 0)
      assert.equal(store.giveaways[giveawayId].participantsCount, 0)
    })
  })
})
