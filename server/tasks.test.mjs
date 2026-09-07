import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  classifyTelegramMemberError,
  isActiveChannelMember,
} from './tasks.mjs'

test('isActiveChannelMember accepts member/admin/creator/restricted(is_member)', () => {
  assert.equal(isActiveChannelMember({ status: 'member' }), true)
  assert.equal(isActiveChannelMember({ status: 'administrator' }), true)
  assert.equal(isActiveChannelMember({ status: 'creator' }), true)
  assert.equal(isActiveChannelMember({ status: 'restricted', is_member: true }), true)
  assert.equal(isActiveChannelMember({ status: 'restricted', is_member: false }), false)
  assert.equal(isActiveChannelMember({ status: 'left' }), false)
  assert.equal(isActiveChannelMember({ status: 'kicked' }), false)
  assert.equal(isActiveChannelMember(null), false)
})

test('classifyTelegramMemberError maps Telegram descriptions', () => {
  assert.equal(classifyTelegramMemberError('Bad Request: USER_NOT_PARTICIPANT'), 'not_member')
  assert.equal(classifyTelegramMemberError('Bad Request: user not found'), 'not_member')
  assert.equal(classifyTelegramMemberError('Bad Request: chat not found'), 'chat_not_found')
  assert.equal(
    classifyTelegramMemberError('Forbidden: bot is not a member of the channel chat', 403),
    'bot_access',
  )
  assert.equal(classifyTelegramMemberError('Bad Request: CHAT_ADMIN_REQUIRED'), 'bot_access')
  assert.equal(classifyTelegramMemberError('something weird'), 'telegram_api_error')
})

async function withIsolatedTasks(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-tasks-'))
  const previousStore = process.env.AZAROV_STORE_DIR
  const previousToken = process.env.BOT_TOKEN
  const previousChannel = process.env.TELEGRAM_CHANNEL

  process.env.AZAROV_STORE_DIR = dir
  process.env.BOT_TOKEN = '123456:TEST_TOKEN'
  process.env.TELEGRAM_CHANNEL = '@azarov222'

  try {
    const stamp = `${Date.now()}-${Math.random()}`
    const { withStore } = await import(`./store.mjs?t=${stamp}`)
    const { createUser } = await import(`./users.mjs?t=${stamp}`)
    const tasks = await import(`./tasks.mjs?t=${stamp}`)

    withStore((store) => {
      createUser(store, { id: 9001, first_name: 'Sub', username: 'subuser' })
    })

    await run({ tasks, withStore, userId: 9001 })
  } finally {
    if (previousStore === undefined) {
      delete process.env.AZAROV_STORE_DIR
    } else {
      process.env.AZAROV_STORE_DIR = previousStore
    }
    if (previousToken === undefined) {
      delete process.env.BOT_TOKEN
    } else {
      process.env.BOT_TOKEN = previousToken
    }
    if (previousChannel === undefined) {
      delete process.env.TELEGRAM_CHANNEL
    } else {
      process.env.TELEGRAM_CHANNEL = previousChannel
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

function mockMemberFetch(status, extra = {}) {
  return async () => ({
    json: async () => ({
      ok: true,
      result: { status, ...extra },
    }),
  })
}

function mockErrorFetch(description, errorCode = 400) {
  return async () => ({
    json: async () => ({
      ok: false,
      error_code: errorCode,
      description,
    }),
  })
}

test('Test 1: subscribed user completes task and receives reward once', async () => {
  await withIsolatedTasks(async ({ tasks, withStore, userId }) => {
    const first = await tasks.checkTelegramSubscribe(userId, 'req-sub-1aaaaaaaa', {
      fetchImpl: mockMemberFetch('member'),
    })

    assert.equal(first.success, true)
    assert.equal(first.completed, true)
    assert.equal(first.rewarded, true)
    assert.equal(first.reward, 500)

    const user = withStore((store) => store.users[String(userId)])
    assert.equal(user.balance, 500)
    assert.ok(user.completedTasks.includes('telegram-subscribe'))
  })
})

test('Test 2: not subscribed user gets no reward', async () => {
  await withIsolatedTasks(async ({ tasks, withStore, userId }) => {
    const result = await tasks.checkTelegramSubscribe(userId, 'req-sub-2bbbbbbbb', {
      fetchImpl: mockMemberFetch('left'),
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'NOT_SUBSCRIBED')
    assert.equal(result.completed, false)

    const user = withStore((store) => store.users[String(userId)])
    assert.equal(user.balance, 0)
    assert.equal(user.completedTasks.includes('telegram-subscribe'), false)
  })
})

test('Test 3: already completed does not grant again', async () => {
  await withIsolatedTasks(async ({ tasks, withStore, userId }) => {
    await tasks.checkTelegramSubscribe(userId, 'req-sub-3aaaaaaaa', {
      fetchImpl: mockMemberFetch('member'),
    })
    const second = await tasks.checkTelegramSubscribe(userId, 'req-sub-3bbbbbbbb', {
      fetchImpl: mockMemberFetch('member'),
    })

    assert.equal(second.success, true)
    assert.equal(second.alreadyCompleted, true)
    assert.equal(second.rewarded, false)

    const user = withStore((store) => store.users[String(userId)])
    assert.equal(user.balance, 500)
  })
})

test('Test 4: completed status survives reload (store re-read)', async () => {
  await withIsolatedTasks(async ({ tasks, withStore, userId }) => {
    await tasks.checkTelegramSubscribe(userId, 'req-sub-4aaaaaaaa', {
      fetchImpl: mockMemberFetch('administrator'),
    })

    const afterReload = withStore((store) => {
      const user = store.users[String(userId)]
      return {
        balance: user.balance,
        completed: user.completedTasks.includes('telegram-subscribe'),
      }
    })

    assert.equal(afterReload.balance, 500)
    assert.equal(afterReload.completed, true)
  })
})

test('Test 5: concurrent-like double check grants only once', async () => {
  await withIsolatedTasks(async ({ tasks, withStore, userId }) => {
    const fetchImpl = mockMemberFetch('member')
    const [a, b] = await Promise.all([
      tasks.checkTelegramSubscribe(userId, 'req-sub-5aaaaaaaa', { fetchImpl }),
      tasks.checkTelegramSubscribe(userId, 'req-sub-5bbbbbbbb', { fetchImpl }),
    ])

    const rewardedCount = [a, b].filter((item) => item.rewarded).length
    const completedCount = [a, b].filter((item) => item.completed).length

    assert.equal(rewardedCount, 1)
    assert.equal(completedCount, 2)

    const user = withStore((store) => store.users[String(userId)])
    assert.equal(user.balance, 500)

    const rewardIds = new Set(
      Object.values(
        withStore((store) => store.coinTransactions),
      )
        .filter((item) => item.type === 'task_reward' && item.userId === userId)
        .map((item) => item.id),
    )
    assert.equal(rewardIds.size, 1)
  })
})

test('Test 6: Telegram API bot access error does not grant reward', async () => {
  await withIsolatedTasks(async ({ tasks, withStore, userId }) => {
    const result = await tasks.checkTelegramSubscribe(userId, 'req-sub-6aaaaaaaa', {
      fetchImpl: mockErrorFetch('Forbidden: bot is not a member of the channel chat', 403),
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'BOT_CHANNEL_ACCESS')
    assert.match(result.message, /администратора|доступ/i)

    const user = withStore((store) => store.users[String(userId)])
    assert.equal(user.balance, 0)
  })
})

test('Test 7: check always uses provided authenticated userId, not a client spoof field', async () => {
  await withIsolatedTasks(async ({ tasks, withStore, userId }) => {
    // Spoof attempt would be a different id; only the authenticated id is passed by the route.
    const foreignId = 999999
    withStore((store) => {
      store.users[String(foreignId)] = {
        telegramId: foreignId,
        firstName: 'Foreign',
        balance: 0,
        completedTasks: [],
        invitedUsers: [],
        referralEarnings: 0,
      }
    })

    const result = await tasks.checkTelegramSubscribe(userId, 'req-sub-7aaaaaaaa', {
      fetchImpl: mockMemberFetch('member'),
    })

    assert.equal(result.success, true)

    const authUser = withStore((store) => store.users[String(userId)])
    const foreign = withStore((store) => store.users[String(foreignId)])
    assert.equal(authUser.balance, 500)
    assert.equal(foreign.balance, 0)
    assert.equal(foreign.completedTasks.includes('telegram-subscribe'), false)
  })
})

test('participant-not-found from Telegram is treated as not subscribed', async () => {
  await withIsolatedTasks(async ({ tasks, withStore, userId }) => {
    const result = await tasks.checkTelegramSubscribe(userId, 'req-sub-8aaaaaaaa', {
      fetchImpl: mockErrorFetch('Bad Request: USER_NOT_PARTICIPANT'),
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'NOT_SUBSCRIBED')
    assert.equal(withStore((store) => store.users[String(userId)]).balance, 0)
  })
})
