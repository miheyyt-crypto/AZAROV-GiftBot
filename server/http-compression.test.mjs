import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import express from 'express'
import { createHttpCompressionMiddleware } from './http-compression.mjs'

async function withServer(handler, run) {
  const app = express()
  app.use(createHttpCompressionMiddleware())
  handler(app)
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    await run(port)
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  }
}

function rawGet(port, path, acceptEncoding) {
  return new Promise((resolve, reject) => {
    http
      .get(
        {
          hostname: '127.0.0.1',
          port,
          path,
          headers: { 'Accept-Encoding': acceptEncoding },
        },
        (response) => {
          const chunks = []
          response.on('data', (c) => chunks.push(c))
          response.on('end', () =>
            resolve({
              encoding: response.headers['content-encoding'] || null,
              cache: response.headers['cache-control'] || null,
              vary: response.headers.vary || null,
              len: Buffer.concat(chunks).length,
            }),
          )
        },
      )
      .on('error', reject)
  })
}

test('compression: prefers br when Accept-Encoding includes br', async () => {
  const body = 'a'.repeat(4000)
  await withServer(
    (app) => {
      app.get('/assets/app.js', (_req, res) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.type('application/javascript')
        res.send(body)
      })
    },
    async (port) => {
      const raw = await rawGet(port, '/assets/app.js', 'br, gzip')
      assert.equal(raw.encoding, 'br')
      assert.equal(raw.cache, 'public, max-age=31536000, immutable')
      assert.ok(raw.len < body.length)
      assert.ok(String(raw.vary || '').toLowerCase().includes('accept-encoding'))

      const res = await fetch(`http://127.0.0.1:${port}/assets/app.js`, {
        headers: { 'Accept-Encoding': 'br, gzip' },
      })
      assert.equal(await res.text(), body)
    },
  )
})

test('compression: gzip fallback when br not accepted', async () => {
  const body = 'b'.repeat(4000)
  await withServer(
    (app) => {
      app.get('/x.css', (_req, res) => {
        res.type('text/css')
        res.send(body)
      })
    },
    async (port) => {
      const raw = await rawGet(port, '/x.css', 'gzip')
      assert.equal(raw.encoding, 'gzip')
      assert.ok(raw.len < body.length)
    },
  )
})

test('compression: skips webp', async () => {
  const body = Buffer.alloc(4000, 7)
  await withServer(
    (app) => {
      app.get('/a.webp', (_req, res) => {
        res.type('image/webp')
        res.send(body)
      })
    },
    async (port) => {
      const raw = await rawGet(port, '/a.webp', 'br, gzip')
      assert.equal(raw.encoding, null)
      assert.equal(raw.len, body.length)
    },
  )
})
