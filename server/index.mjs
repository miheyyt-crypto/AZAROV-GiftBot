import { config as loadEnv } from 'dotenv'
import express from 'express'
import multer from 'multer'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { verifyTelegramInitData } from './auth.mjs'
import { createCorsMiddleware } from './cors.mjs'
import { asyncHandler, HttpError, sendSafeError } from './errors.mjs'
import { toPublicUser } from './users.mjs'
import { bootstrapUser, activateReferral, readReferralMe } from './referrals.mjs'
import { checkTelegramSubscribe, claimInviteFriendsTask } from './tasks.mjs'
import { startPartnerTask, verifyPartnerTask } from './partner-tasks.mjs'
import {
  approvePartnerSubmission,
  createPartnerSubmission,
  getAdminSubmission,
  getSubmissionScreenshot,
  getTaskSubmissionStates,
  listAdminPartnerSubmissions,
  listMyPartnerSubmissions,
  rejectPartnerSubmission,
} from './partner-submissions.mjs'
import { listPartnersPublic } from './partners.mjs'
import { MAX_SCREENSHOT_BYTES, isForbiddenOriginalName } from './uploads.mjs'
import { purchaseProduct, getUserOrders, getOrder, cancelOrder } from './shop.mjs'
import { openCase } from './cases.mjs'
import { getLeaderboard, getRecentCaseDrops } from './home.mjs'
import {
  getAchievementsProgress,
  getCoinHistory,
  getInventory,
  getPendingOrders,
} from './profile.mjs'
import { getUser } from './store.mjs'
import {
  assertNoClientFinancialOverrides,
  parseCaseId,
  parseCoinHistoryFilter,
  parseOrderId,
  parsePartnerTaskId,
  parseProductId,
  parseRequestId,
  sanitizePurchaseMetadata,
} from './validate.mjs'
import { clientIp, createRateLimiter, timingSafeEqualString } from './rate-limit.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: path.join(rootDir, '.env') })

const PORT = Number(process.env.PORT || 3001)
const HOST = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const app = express()
const distDir = path.resolve(rootDir, 'dist')

function assertProductionEnv() {
  if (!IS_PRODUCTION) {
    return
  }

  const missing = []
  if (!String(process.env.BOT_TOKEN || '').trim()) missing.push('BOT_TOKEN')
  if (
    !String(process.env.CORS_ORIGINS || '').trim() &&
    !String(process.env.WEBAPP_URL || '').trim()
  ) {
    missing.push('CORS_ORIGINS or WEBAPP_URL')
  }
  const adminKey = String(process.env.ADMIN_API_KEY || '').trim()
  if (!adminKey) {
    missing.push('ADMIN_API_KEY')
  } else if (adminKey.length < 32) {
    console.error('[boot] ADMIN_API_KEY must be at least 32 characters in production.')
    process.exit(1)
  }

  if (missing.length) {
    console.error(`[boot] Missing required production env: ${missing.join(', ')}`)
    process.exit(1)
  }
}

assertProductionEnv()

const adminAuthLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 })
const partnerUploadLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10 })

const partnerUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SCREENSHOT_BYTES,
    files: 1,
    fields: 8,
  },
  fileFilter(_req, file, cb) {
    // Never trust client filename — only use it as a coarse reject list.
    if (isForbiddenOriginalName(file.originalname)) {
      cb(new Error('FORBIDDEN_TYPE'))
      return
    }
    cb(null, true)
  },
})

function partnerScreenshotUpload(req, res, next) {
  partnerUpload.single('screenshot')(req, res, (error) => {
    if (!error) {
      // Drop untrusted filename from the request object.
      if (req.file) {
        req.file.originalname = 'screenshot'
      }
      next()
      return
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        success: false,
        message: 'Скриншот больше 5 МБ.',
      })
      return
    }

    if (error.message === 'FORBIDDEN_TYPE') {
      res.status(400).json({
        success: false,
        message: 'Разрешены только JPG, PNG или WEBP.',
      })
      return
    }

    res.status(400).json({
      success: false,
      message: 'Не удалось загрузить файл.',
    })
  })
}

app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))
app.use(createCorsMiddleware())

function readInitData(req) {
  const header = req.headers.authorization || ''
  if (header.startsWith('tma ')) {
    return header.slice(4).trim()
  }
  // Legacy fallback: still cryptographically verified via verifyTelegramInitData.
  if (typeof req.body?.initData === 'string') {
    return req.body.initData
  }
  return ''
}

function requireTelegramAuth(req, res) {
  const botToken = process.env.BOT_TOKEN || ''
  const initData = readInitData(req)

  if (!botToken) {
    res.status(503).json({
      success: false,
      message: 'Сервер ещё не настроен для проверки Telegram.',
    })
    return null
  }

  if (!initData) {
    res.status(401).json({
      success: false,
      message: 'Открой приложение в Telegram.',
    })
    return null
  }

  try {
    return verifyTelegramInitData(initData, botToken)
  } catch {
    res.status(401).json({
      success: false,
      message: 'Не удалось подтвердить Telegram-сессию.',
    })
    return null
  }
}

function requireTelegramUser(req, res) {
  return requireTelegramAuth(req, res)?.user ?? null
}

function withUser(handler) {
  return asyncHandler(async (req, res) => {
    assertNoClientFinancialOverrides(req.body)
    const telegramUser = requireTelegramUser(req, res)
    if (!telegramUser) {
      return
    }
    await handler(req, res, telegramUser)
  })
}

function requireAdmin(req, res) {
  const configured = String(process.env.ADMIN_API_KEY || '').trim()
  if (!configured) {
    res.status(503).json({
      success: false,
      message: 'Админ API ещё не настроен.',
    })
    return false
  }

  const ip = clientIp(req)
  const provided = String(req.headers['x-admin-key'] || '').trim()
  if (!provided || !timingSafeEqualString(provided, configured)) {
    const limit = adminAuthLimiter.check(`admin-fail:${ip}`)
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000) || 1))
      res.status(429).json({
        success: false,
        message: 'Слишком много попыток. Попробуй позже.',
      })
      return false
    }

    res.status(401).json({
      success: false,
      message: 'Нет доступа.',
    })
    return false
  }

  return true
}

function withAdmin(handler) {
  return asyncHandler(async (req, res) => {
    if (!requireAdmin(req, res)) {
      return
    }
    await handler(req, res)
  })
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
  })
})

app.post(
  '/api/session',
  asyncHandler(async (req, res) => {
    assertNoClientFinancialOverrides(req.body)
    const auth = requireTelegramAuth(req, res)
    if (!auth) {
      return
    }

    // Only trust start_param from signed Telegram initData — never from client body.
    const startParam = auth.startParam || ''

    const result = bootstrapUser(auth.user, startParam)
    const user = getUser(auth.user.id)

    res.json({
      success: true,
      user: toPublicUser(user),
      referral: result.referral,
      referralStats: result.me,
    })
  }),
)

app.get(
  '/api/me',
  withUser(async (_req, res, telegramUser) => {
    const result = bootstrapUser(telegramUser, '')
    res.json({
      success: true,
      user: toPublicUser(getUser(telegramUser.id)),
      referral: result.referral,
      referralStats: result.me,
    })
  }),
)

app.get(
  '/api/referral/me',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = readReferralMe(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/tasks/telegram-subscribe/check',
  withUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = await checkTelegramSubscribe(telegramUser.id, requestId)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/tasks/invite-friends/claim',
  withUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = claimInviteFriendsTask(telegramUser.id, requestId)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/referrals/activate',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = activateReferral(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/partners/tasks/start',
  withUser(async (req, res, telegramUser) => {
    const taskId = parsePartnerTaskId(req.body?.taskId)
    bootstrapUser(telegramUser, '')
    const result = startPartnerTask(telegramUser.id, taskId)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/partners/tasks/verify',
  withUser(async (req, res, telegramUser) => {
    parsePartnerTaskId(req.body?.taskId)
    parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = verifyPartnerTask()
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/partners/tasks',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const states = getTaskSubmissionStates(telegramUser.id)
    res.json({
      success: true,
      partners: listPartnersPublic(),
      ...states,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/partners/submissions/my',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = listMyPartnerSubmissions(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/partners/submissions',
  asyncHandler(async (req, res, next) => {
    // Auth before multer so anonymous clients cannot force 5MB memory buffers.
    const telegramUser = requireTelegramUser(req, res)
    if (!telegramUser) {
      return
    }

    const limit = partnerUploadLimiter.check(`upload:${telegramUser.id}`)
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000) || 1))
      res.status(429).json({
        success: false,
        message: 'Слишком много загрузок. Подожди немного.',
      })
      return
    }

    req.telegramUser = telegramUser
    next()
  }),
  partnerScreenshotUpload,
  asyncHandler(async (req, res) => {
    const telegramUser = req.telegramUser
    assertNoClientFinancialOverrides(req.body)

    const taskId = parsePartnerTaskId(req.body?.taskId)
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')

    const result = createPartnerSubmission(
      telegramUser.id,
      {
        taskId,
        partnerAccountId: req.body?.partnerAccountId,
        requestId,
      },
      req.file,
    )

    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/partners/submissions/:submissionId/screenshot',
  withUser(async (req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = getSubmissionScreenshot(String(req.params.submissionId || ''), {
      viewerUserId: telegramUser.id,
      isAdmin: false,
    })
    if (!result.success) {
      res.status(result.message === 'Нет доступа.' ? 403 : 404).json(result)
      return
    }

    res.setHeader('Content-Type', result.mime)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', 'inline')
    res.sendFile(result.absolutePath)
  }),
)

app.get(
  '/api/admin/partners/submissions',
  withAdmin(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : ''
    const result = listAdminPartnerSubmissions(status)
    res.json(result)
  }),
)

app.get(
  '/api/admin/partners/submissions/:submissionId',
  withAdmin(async (req, res) => {
    const result = getAdminSubmission(String(req.params.submissionId || ''))
    res.status(result.success ? 200 : 404).json(result)
  }),
)

app.get(
  '/api/admin/partners/submissions/:submissionId/screenshot',
  withAdmin(async (req, res) => {
    const result = getSubmissionScreenshot(String(req.params.submissionId || ''), {
      isAdmin: true,
    })
    if (!result.success) {
      res.status(404).json(result)
      return
    }

    res.setHeader('Content-Type', result.mime)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', 'inline')
    res.sendFile(result.absolutePath)
  }),
)

app.post(
  '/api/admin/partners/submissions/:submissionId/approve',
  withAdmin(async (req, res) => {
    const requestId =
      typeof req.body?.requestId === 'string' && req.body.requestId.trim()
        ? parseRequestId(req.body.requestId)
        : ''
    const reviewedBy =
      typeof req.body?.reviewedBy === 'string' && req.body.reviewedBy.trim()
        ? req.body.reviewedBy.trim().slice(0, 64)
        : 'admin'
    const result = approvePartnerSubmission(
      String(req.params.submissionId || ''),
      reviewedBy,
      requestId,
    )
    res.json(result)
  }),
)

app.post(
  '/api/admin/partners/submissions/:submissionId/reject',
  withAdmin(async (req, res) => {
    const requestId =
      typeof req.body?.requestId === 'string' && req.body.requestId.trim()
        ? parseRequestId(req.body.requestId)
        : ''
    const reviewedBy =
      typeof req.body?.reviewedBy === 'string' && req.body.reviewedBy.trim()
        ? req.body.reviewedBy.trim().slice(0, 64)
        : 'admin'
    const rejectionReason =
      typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason : ''
    const result = rejectPartnerSubmission(
      String(req.params.submissionId || ''),
      reviewedBy,
      rejectionReason,
      requestId,
    )
    res.json(result)
  }),
)

app.post(
  '/api/shop/purchase',
  withUser(async (req, res, telegramUser) => {
    const productId = parseProductId(req.body?.productId)
    const requestId = parseRequestId(req.body?.requestId)
    const metadata = sanitizePurchaseMetadata(req.body?.metadata)
    bootstrapUser(telegramUser, '')
    const result = purchaseProduct(telegramUser.id, productId, requestId, metadata)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/shop/orders',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = getUserOrders(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/shop/orders/:orderId',
  withUser(async (req, res, telegramUser) => {
    const orderId = parseOrderId(req.params.orderId)
    bootstrapUser(telegramUser, '')
    const result = getOrder(telegramUser.id, orderId)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/shop/orders/:orderId/cancel',
  withUser(async (req, res, telegramUser) => {
    const orderId = parseOrderId(req.params.orderId)
    bootstrapUser(telegramUser, '')
    const result = cancelOrder(telegramUser.id, orderId)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get('/api/home/leaderboard', (_req, res) => {
  const result = getLeaderboard(3)
  res.json(result)
})

app.get('/api/home/recent-drops', (_req, res) => {
  const result = getRecentCaseDrops(12)
  res.json(result)
})

app.get(
  '/api/profile/coin-history',
  withUser(async (req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const filter = parseCoinHistoryFilter(req.query.filter)
    const result = getCoinHistory(telegramUser.id, filter)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/profile/inventory',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = getInventory(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/profile/achievements',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = getAchievementsProgress(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/profile/orders/pending',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = getPendingOrders(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/cases/open',
  withUser(async (req, res, telegramUser) => {
    const caseId = parseCaseId(req.body?.caseId)
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = openCase(telegramUser.id, caseId, requestId)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

// Serve the Vite production build when present (Railway / npm run build).
// API routes above always take precedence. Uploads and server/data are never exposed here.
const canServeFrontend = existsSync(path.join(distDir, 'index.html'))
if (canServeFrontend) {
  app.use(
    express.static(distDir, {
      index: false,
      fallthrough: true,
    }),
  )
} else if (IS_PRODUCTION) {
  console.warn('[boot] dist/ is missing. Run `npm run build` before production start.')
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({
      success: false,
      message: 'Маршрут не найден.',
    })
    return
  }

  if (canServeFrontend && (req.method === 'GET' || req.method === 'HEAD')) {
    res.sendFile(path.join(distDir, 'index.html'), (error) => {
      if (error) {
        next(error)
      }
    })
    return
  }

  res.status(404).json({
    success: false,
    message: 'Маршрут не найден.',
  })
})

app.use((error, _req, res, _next) => {
  if (error instanceof HttpError) {
    sendSafeError(res, error)
    return
  }

  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      message: 'Некорректный JSON.',
    })
    return
  }

  sendSafeError(res, error)
})

export { app, PORT, HOST }

export function startHttpServer() {
  const server = app.listen(PORT, HOST, () => {
    console.log(`AZAROV GiftBot API listening on http://${HOST}:${PORT}`)
    if (canServeFrontend) {
      console.log(`[boot] Serving frontend from ${distDir}`)
    }
  })
  return server
}

function attachHttpShutdown(server) {
  function shutdown(signal) {
    console.info(`[API] ${signal} received, shutting down…`)
    server.close((error) => {
      if (error) {
        console.error('[API] shutdown error', error.message)
        process.exit(1)
        return
      }
      process.exit(0)
    })

    setTimeout(() => {
      console.error('[API] forced exit after shutdown timeout')
      process.exit(1)
    }, 10_000).unref()
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const server = startHttpServer()
  attachHttpShutdown(server)
}
