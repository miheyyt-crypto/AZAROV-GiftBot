import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  clearPendingGiveawayWizards,
  getPendingGiveawayWizard,
  parseDurationInput,
  parsePrizeAmountInput,
  parseWinnersCountInput,
} from './giveaway-admin.mjs'
import { createGiveaway, peekGiveaway, stopGiveawayScheduler } from './giveaways.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-gw-admin-'))
  const previous = process.env.AZAROV_STORE_DIR
  const prevAdmins = process.env.ADMIN_TELEGRAM_IDS
  process.env.AZAROV_STORE_DIR = dir
  process.env.ADMIN_TELEGRAM_IDS = '42'
  stopGiveawayScheduler()
  clearPendingGiveawayWizards()

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      stopGiveawayScheduler()
      clearPendingGiveawayWizards()
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      if (prevAdmins === undefined) delete process.env.ADMIN_TELEGRAM_IDS
      else process.env.ADMIN_TELEGRAM_IDS = prevAdmins
      rmSync(dir, { recursive: true, force: true })
    })
}

test('parsePrizeAmountInput accepts positive integers only', () => {
  assert.equal(parsePrizeAmountInput('100').ok, true)
  assert.equal(parsePrizeAmountInput('100').value, 100)
  assert.equal(parsePrizeAmountInput('0').ok, false)
  assert.equal(parsePrizeAmountInput('-5').ok, false)
  assert.equal(parsePrizeAmountInput('abc').ok, false)
  assert.equal(parsePrizeAmountInput('10.5').ok, false)
})

test('parseWinnersCountInput enforces 1..1000', () => {
  assert.equal(parseWinnersCountInput('1').ok, true)
  assert.equal(parseWinnersCountInput('0').ok, false)
  assert.equal(parseWinnersCountInput('1001').ok, false)
})

test('parseDurationInput supports shortcuts and presets', () => {
  assert.equal(parseDurationInput('2м').ms, 120_000)
  assert.equal(parseDurationInput('1ч').ms, 3_600_000)
  assert.equal(parseDurationInput('24h').ms, 24 * 3_600_000)
  assert.equal(parseDurationInput('2m').id, '2m')
  assert.equal(parseDurationInput('nope'), null)
})

test('createGiveaway 100 coins for 2 minutes works via backend API used by bot', async () => {
  await withTempStore(async () => {
    const now = Date.now()
    const created = createGiveaway(
      {
        title: 'Розыгрыш 100 монет',
        description: 'test',
        image: 'https://example.com/g.png',
        prizeType: 'coins',
        prizeAmount: 100,
        winnersCount: 1,
        startAt: new Date(now).toISOString(),
        endAt: new Date(now + 120_000).toISOString(),
      },
      { createdBy: 'tg:42' },
    )
    assert.equal(created.success, true)
    const row = peekGiveaway(created.giveaway.id)
    assert.equal(row.status, 'active')
    assert.equal(row.prizeAmount, 100)
    assert.equal(row.winnersCount, 1)
    assert.ok(Date.parse(row.endAt) - Date.parse(row.startAt) === 120_000)
  })
})

test('parseCustomPrizeInput accepts free-form prize text', async () => {
  const { parseCustomPrizeInput } = await import('./giveaway-admin.mjs')
  assert.equal(parseCustomPrizeInput('5 000 рублей').ok, true)
  assert.equal(parseCustomPrizeInput('').ok, false)
})
