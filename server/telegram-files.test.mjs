import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearTelegramFileCache,
  fetchTelegramFileById,
} from './telegram-files.mjs'

test('fetchTelegramFileById rejects missing file id', async () => {
  clearTelegramFileCache()
  const result = await fetchTelegramFileById('')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'missing_file_id')
})

test('fetchTelegramFileById caches successful download', async () => {
  clearTelegramFileCache()
  const previous = process.env.BOT_TOKEN
  process.env.BOT_TOKEN = '123456:TEST_TOKEN'

  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('/getFile')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { file_path: 'photos/file_99.jpg' },
        }),
      }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }
  }

  try {
    const first = await fetchTelegramFileById('file-abc', { fetchImpl, ttlMs: 60_000 })
    assert.equal(first.ok, true)
    assert.equal(first.fromCache, false)
    assert.equal(first.contentType, 'image/jpeg')
    assert.deepEqual([...first.buffer], [1, 2, 3, 4])

    const second = await fetchTelegramFileById('file-abc', { fetchImpl, ttlMs: 60_000 })
    assert.equal(second.ok, true)
    assert.equal(second.fromCache, true)
    assert.equal(calls.length, 2) // getFile + download once
  } finally {
    clearTelegramFileCache()
    if (previous === undefined) delete process.env.BOT_TOKEN
    else process.env.BOT_TOKEN = previous
  }
})
