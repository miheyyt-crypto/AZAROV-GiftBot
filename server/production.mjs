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

// Always bind HTTP first so Railway healthchecks / Mini App stay up even if
 // Telegraf getUpdates is stuck on a 409 Conflict from a previous replica.
const server = startHttpServer()
let bot = null
let attachInFlight = false

async function attachBot(reason = 'boot') {
  if (bot || getBotRuntimeDiagnostics().pollingActive || attachInFlight) {
    return bot
  }
  attachInFlight = true
  try {
    console.info('[production] attaching Telegram Bot…', { reason })
    const next = await startBot({ registerSignals: false })
    if (next) {
      bot = next
      console.info('[production] Telegram Bot attached (long polling).', {
        username: getBotRuntimeDiagnostics().botUsername,
      })
    } else {
      console.error('[production] Telegram Bot attach failed', getBotRuntimeDiagnostics())
    }
    return bot
  } finally {
    attachInFlight = false
  }
}

// Never block API boot on bot.launch — previous replica can hold getUpdates for minutes.
void attachBot('initial')

const retryTimer = setInterval(() => {
  if (bot || getBotRuntimeDiagnostics().pollingActive) {
    return
  }
  void attachBot('retry')
}, 5_000)
if (typeof retryTimer.unref === 'function') {
  retryTimer.unref()
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
