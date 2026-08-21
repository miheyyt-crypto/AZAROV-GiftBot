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
const { startBot } = await import('./bot.mjs')

const server = startHttpServer()
const bot = await startBot({ registerSignals: false })

if (!bot) {
  // index.mjs assertProductionEnv already requires BOT_TOKEN in production and exits.
  // This branch covers non-strict local experiments with NODE_ENV=production unset wrongly.
  console.error(
    '[production] Telegram Bot did not start (BOT_TOKEN missing or launch failed). API may still be running.',
  )
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
