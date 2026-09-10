import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Production launcher for Railway (single service):
 * - Express API (+ React dist when built)
 * - Telegram Bot (long polling)
 *
 * Do not use --watch or Vite here.
 */
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: path.join(rootDir, '.env') })

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production'
}

const { startHttpServer } = await import('./index.mjs')
const { startBot, getBotRuntimeDiagnostics } = await import('./bot.mjs')

const server = startHttpServer()
let bot = await startBot({ registerSignals: false })

if (!bot) {
  // Common during Railway rolling restart: previous replica still holds getUpdates (409).
  // Keep API up and retry bot attach until polling is active.
  console.error(
    '[production] Telegram Bot did not start yet — retrying in background (API stays up).',
    getBotRuntimeDiagnostics(),
  )
  const retryMs = 5_000
  const retryTimer = setInterval(() => {
    void (async () => {
      if (bot || getBotRuntimeDiagnostics().pollingActive) {
        clearInterval(retryTimer)
        return
      }
      console.info('[production] retrying Telegram Bot launch…')
      bot = await startBot({ registerSignals: false })
      if (bot) {
        console.info('[production] Telegram Bot attached after retry (long polling).')
        clearInterval(retryTimer)
      }
    })()
  }, retryMs)
  if (typeof retryTimer.unref === 'function') {
    retryTimer.unref()
  }
} else {
  console.info('[production] Telegram Bot attached to this process (long polling).')
}

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  console.info(`[production] ${signal} received, shutting down…`)

  const tasks = []

  tasks.push(
    new Promise((resolve) => {
      server.close((error) => {
        if (error) {
          console.error('[production] HTTP close error', error.message)
        }
        resolve()
      })
    }),
  )

  if (bot) {
    tasks.push(
      Promise.resolve()
        .then(() => bot.stop(signal))
        .catch((error) => {
          console.error('[production] Bot stop error', {
            message: error instanceof Error ? error.message : 'unknown_error',
          })
        }),
    )
  }

  const forceTimer = setTimeout(() => {
    console.error('[production] forced exit after shutdown timeout')
    process.exit(1)
  }, 10_000)
  forceTimer.unref()

  await Promise.all(tasks)
  clearTimeout(forceTimer)
  process.exit(0)
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})
process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})
