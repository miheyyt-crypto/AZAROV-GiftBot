import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  LAUNCH_BOT_REWARD,
  LAUNCH_BOT_START_PAYLOAD,
  LAUNCH_BOT_TASK_ID,
} from './constants.mjs'

async function withIsolated(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-launch-bot-'))
  const previousStore = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir

  try {
    const stamp = `${Date.now()}-${Math.random()}`
    const { withStore } = await import(`./store.mjs?t=${stamp}`)
    const { createUser } = await import(`./users.mjs?t=${stamp}`)
    const tasks = await import(`./tasks.mjs?t=${stamp}`)

    withStore((store) => {
      createUser(store, { id: 77001, first_name: 'Launch', username: 'launchuser' })
    })

    await run({ tasks, withStore, userId: 77001 })
  } finally {
    if (previousStore === undefined) delete process.env.AZAROV_STORE_DIR
    else process.env.AZAROV_STORE_DIR = previousStore
    rmSync(dir, { recursive: true, force: true })
  }
}

test('isLaunchBotStartPayload accepts launch_bot variants', async () => {
  await withIsolated(async ({ tasks }) => {
    assert.equal(tasks.isLaunchBotStartPayload(LAUNCH_BOT_START_PAYLOAD), true)
    assert.equal(tasks.isLaunchBotStartPayload('LAUNCH_BOT'), true)
    assert.equal(tasks.isLaunchBotStartPayload('task_launch_bot'), true)
    assert.equal(tasks.isLaunchBotStartPayload('ref_ABCDEFGH'), false)
    assert.equal(tasks.isLaunchBotStartPayload(''), false)
  })
})

test('launch-bot check denies without /start proof', async () => {
  await withIsolated(async ({ tasks, withStore, userId }) => {
    const denied = tasks.checkLaunchBot(userId, 'req-launch-1')
    assert.equal(denied.success, false)
    assert.equal(denied.code, 'NOT_STARTED')
    assert.equal(denied.rewarded, false)

    withStore((store) => {
      assert.equal(store.users[String(userId)].completedTasks.includes(LAUNCH_BOT_TASK_ID), false)
      assert.equal(store.users[String(userId)].balance, 0)
    })
  })
})

test('launch-bot awards once after markBotLaunchStart', async () => {
  await withIsolated(async ({ tasks, withStore, userId }) => {
    tasks.markBotLaunchStart(userId)

    const first = tasks.checkLaunchBot(userId, 'req-launch-ok-1')
    assert.equal(first.success, true)
    assert.equal(first.completed, true)
    assert.equal(first.rewarded, true)
    assert.equal(first.reward, LAUNCH_BOT_REWARD)

    withStore((store) => {
      const user = store.users[String(userId)]
      assert.equal(user.balance, LAUNCH_BOT_REWARD)
      assert.ok(user.completedTasks.includes(LAUNCH_BOT_TASK_ID))
      assert.ok(user.botLaunchVerifiedAt)
    })

    const second = tasks.checkLaunchBot(userId, 'req-launch-ok-2')
    assert.equal(second.success, true)
    assert.equal(second.alreadyCompleted, true)
    assert.equal(second.rewarded, false)

    withStore((store) => {
      assert.equal(store.users[String(userId)].balance, LAUNCH_BOT_REWARD)
    })

    const replay = tasks.checkLaunchBot(userId, 'req-launch-ok-1')
    assert.equal(replay.success, true)
    assert.equal(replay.rewarded, true)
    assert.equal(replay.reward, LAUNCH_BOT_REWARD)

    withStore((store) => {
      assert.equal(store.users[String(userId)].balance, LAUNCH_BOT_REWARD)
    })
  })
})
