import { config as loadEnv } from 'dotenv'
import express from 'express'
import multer from 'multer'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { verifyTelegramInitData, verifyTelegramLoginWidget } from './auth.mjs'
import { createCorsMiddleware } from './cors.mjs'
import { asyncHandler, HttpError, sendSafeError } from './errors.mjs'
import { extractReferralCode, toPublicUser } from './users.mjs'
import { bootstrapUser, activateReferral, readReferralMe } from './referrals.mjs'
import { checkTelegramSubscribe, claimInviteFriendsTask } from './tasks.mjs'
import {
  buildKickResultRedirect,
  completeKickOAuthCallback,
  createKickOAuthStart,
  isKickOAuthConfigured,
  readKickConnection,
} from './kick-oauth.mjs'
import { bootstrapKickFollowInfrastructure } from './kick-api.mjs'
import { checkKickFollow, handleKickFollowWebhook } from './kick-follow.mjs'
import { resetAllKickBindingsOnStore } from './kick-reset.mjs'
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
import {
  assertPersistentStoreOrExit,
  getStoreDiagnostics,
  getUser,
  withStore,
} from './store.mjs'
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
import {
  clearWebSessionCookie,
  createWebSession,
  purgeExpiredWebSessions,
  readWebSessionToken,
  resolveWebSession,
  revokeWebSession,
  setWebSessionCookie,
} from './web-sessions.mjs'

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
assertPersistentStoreOrExit()

const adminAuthLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 })
const partnerUploadLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10 })
const webLoginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 })

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
app.use(
  express.json({
    limit: '256kb',
    verify(req, _res, buf) {
      // Keep raw body for Kick webhook RSA signature verification.
      if (req.originalUrl?.startsWith('/api/kick/webhooks')) {
        req.rawBody = buf.toString('utf8')
      }
    },
  }),
)

const corsMiddleware = createCorsMiddleware()

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return corsMiddleware(req, res, next)
  }

  next()
})

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

/**
 * Resolve identity from Mini App initData (preferred) or HttpOnly web session cookie.
 * Mini App path is unchanged; web session is additive for website Login Widget.
 */
function requireTelegramAuth(req, res) {
  const botToken = process.env.BOT_TOKEN || ''
  const initData = readInitData(req)

  if (initData) {
    if (!botToken) {
      res.status(503).json({
        success: false,
        message: 'Сервер ещё не настроен для проверки Telegram.',
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

  const sessionToken = readWebSessionToken(req)
  if (sessionToken) {
    const session = resolveWebSession(sessionToken)
    if (!session) {
      clearWebSessionCookie(res)
      res.status(401).json({
        success: false,
        message: 'Сессия истекла. Войди через Telegram снова.',
      })
      return null
    }

    const stored = getUser(session.telegramUserId)
    if (!stored) {
      clearWebSessionCookie(res)
      revokeWebSession(sessionToken)
      res.status(401).json({
        success: false,
        message: 'Пользователь не найден. Войди через Telegram снова.',
      })
      return null
    }

    return {
      user: {
        id: Number(stored.telegramId),
        first_name: stored.firstName || '',
        last_name: stored.lastName || undefined,
        username: stored.username || undefined,
        photo_url: stored.photoUrl || undefined,
        language_code: stored.languageCode || undefined,
        is_premium: Boolean(stored.isPremium),
      },
      startParam: '',
      authSource: 'web_session',
    }
  }

  res.status(401).json({
    success: false,
    message: 'Открой приложение в Telegram или войди через Telegram на сайте.',
  })
  return null
}

function requireTelegramUser(req, res) {
  return requireTelegramAuth(req, res)?.user ?? null
}

function parseTelegramLoginPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Нужны данные Telegram Login.', 'INVALID_LOGIN_PAYLOAD')
  }

  // Accept either flat widget fields or { user: { ... } } wrapper.
  const source =
    body.user && typeof body.user === 'object' && !Array.isArray(body.user) ? body.user : body

  const id = Number(source.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, 'Некорректный Telegram ID.', 'INVALID_LOGIN_PAYLOAD')
  }

  const authDate = Number(source.auth_date)
  if (!Number.isInteger(authDate) || authDate <= 0) {
    throw new HttpError(400, 'Некорректный auth_date.', 'INVALID_LOGIN_PAYLOAD')
  }

  const hash = String(source.hash || '').trim()
  if (!hash) {
    throw new HttpError(400, 'Отсутствует подпись Telegram.', 'INVALID_LOGIN_PAYLOAD')
  }

  if (typeof source.first_name !== 'string' || !source.first_name.trim()) {
    throw new HttpError(400, 'Некорректные данные Telegram Login.', 'INVALID_LOGIN_PAYLOAD')
  }

  const payload = {
    id,
    first_name: source.first_name.trim().slice(0, 128),
    auth_date: authDate,
    hash,
  }
  if (typeof source.last_name === 'string') {
    payload.last_name = source.last_name.slice(0, 128)
  }
  if (typeof source.username === 'string') {
    payload.username = source.username.slice(0, 64)
  }
  if (typeof source.photo_url === 'string') {
    payload.photo_url = source.photo_url.slice(0, 512)
  }

  return payload
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
  const store = getStoreDiagnostics()
  res.json({
    ok: true,
    store: {
      persistent: store.persistent,
      source: store.source,
      exists: store.exists,
      backupExists: store.backupExists,
      usersCount: store.usersCount,
      ...(store.error ? { error: store.error } : {}),
    },
  })
})

/**
 * Start Kick OAuth (PKCE). Requires existing Telegram Mini App / web session auth.
 * Returns authorizationUrl for the client to open — never exposes client secret.
 */
app.post(
  '/api/kick/oauth/start',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = createKickOAuthStart(telegramUser.id)
    res.status(result.success ? 200 : result.code === 'already_connected' ? 409 : 503).json({
      ...result,
      configured: isKickOAuthConfigured(),
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/kick/me',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const connection = readKickConnection(telegramUser.id)
    res.json({
      success: true,
      configured: isKickOAuthConfigured(),
      connection,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

/**
 * Kick OAuth redirect URI. Must match KICK_REDIRECT_URI / Kick Developer settings.
 * Example production: https://azarov-giftbot-production.up.railway.app/api/kick/callback
 */
app.get(
  '/api/kick/callback',
  asyncHandler(async (req, res) => {
    const result = await completeKickOAuthCallback({
      code: typeof req.query.code === 'string' ? req.query.code : '',
      state: typeof req.query.state === 'string' ? req.query.state : '',
      error: typeof req.query.error === 'string' ? req.query.error : '',
      errorDescription:
        typeof req.query.error_description === 'string' ? req.query.error_description : '',
    })

    const status = result.success
      ? result.code === 'already_connected'
        ? 'already'
        : 'connected'
      : result.code || 'error'

    const redirectTo = buildKickResultRedirect(status, result.message || '')
    res.redirect(302, redirectTo)
  }),
)

/**
 * Website Telegram Login Widget → verified backend session (HttpOnly cookie).
 * Does not replace Mini App /api/session + initData flow.
 */
app.post(
  '/api/auth/telegram-web',
  asyncHandler(async (req, res) => {
    assertNoClientFinancialOverrides(req.body)

    const ip = clientIp(req)
    const limit = webLoginLimiter.check(`web-login:${ip}`)
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000) || 1))
      res.status(429).json({
        success: false,
        message: 'Слишком много попыток входа. Попробуй позже.',
      })
      return
    }

    const botToken = process.env.BOT_TOKEN || ''
    if (!botToken) {
      res.status(503).json({
        success: false,
        message: 'Сервер ещё не настроен для проверки Telegram.',
      })
      return
    }

    let payload
    try {
      payload = parseTelegramLoginPayload(req.body)
    } catch (error) {
      if (error instanceof HttpError) {
        sendSafeError(res, error)
        return
      }
      throw error
    }

    let verified
    try {
      verified = verifyTelegramLoginWidget(payload, botToken)
    } catch (error) {
      const code = error?.message || 'invalid_hash'
      if (code === 'expired') {
        res.status(401).json({
          success: false,
          code: 'EXPIRED',
          message: 'Данные входа устарели. Попробуй войти снова.',
        })
        return
      }

      res.status(401).json({
        success: false,
        code: 'INVALID_SIGNATURE',
        message: 'Не удалось подтвердить вход через Telegram.',
      })
      return
    }

    purgeExpiredWebSessions()

    const result = bootstrapUser(verified.user, '')
    const user = getUser(verified.user.id)
    if (!user) {
      res.status(500).json({
        success: false,
        message: 'Не удалось создать пользователя.',
      })
      return
    }

    const session = createWebSession(user.telegramId, {
      userAgent: String(req.headers['user-agent'] || ''),
      ip,
    })
    setWebSessionCookie(res, session.token, session.expiresAt)

    res.json({
      success: true,
      message: 'Вход выполнен.',
      user: toPublicUser(user),
      referral: result.referral,
      referralStats: result.me,
      expiresAt: session.expiresAt,
    })
  }),
)

app.post(
  '/api/auth/logout',
  asyncHandler(async (req, res) => {
    const token = readWebSessionToken(req)
    if (token) {
      revokeWebSession(token)
    }
    clearWebSessionCookie(res)
    res.json({
      success: true,
      message: 'Выход выполнен.',
    })
  }),
)

app.get(
  '/api/auth/me',
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

app.post(
  '/api/session',
  asyncHandler(async (req, res) => {
    assertNoClientFinancialOverrides(req.body)
    const auth = requireTelegramAuth(req, res)
    if (!auth) {
      return
    }

    // Prefer signed start_param from Telegram initData.
    // Fall back to client-reported startapp/tgWebAppStartParam (same Mini App session)
    // and then to bot /start pending payload. Referral rewards stay server-side + idempotent.
    const signedStartParam = auth.startParam || ''
    const clientStartParam =
      typeof req.body?.startParam === 'string' ? req.body.startParam.trim().slice(0, 64) : ''

    console.info('[referral] session_start_param', {
      telegramId: auth.user.id,
      hasSigned: Boolean(signedStartParam),
      hasClient: Boolean(clientStartParam),
      signedCode: extractReferralCode(signedStartParam),
      clientCode: extractReferralCode(clientStartParam),
    })

    const result = bootstrapUser(auth.user, signedStartParam, { clientStartParam })
    const user = getUser(auth.user.id)

    console.info('[referral] session_result', {
      telegramId: auth.user.id,
      referralReason: result.referral?.reason || null,
      referralApplied: Boolean(result.referral?.applied),
      activationReason: result.activation?.reason || null,
      activationRewarded: Boolean(result.activation?.rewarded),
      referredByUserId: user?.referredByUserId || null,
    })

    res.json({
      success: true,
      user: toPublicUser(user),
      referral: result.referral,
      referralStats: result.me,
      activation: result.activation,
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
  '/api/tasks/kick-follow/check',
  withUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = await checkKickFollow(telegramUser.id, requestId)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

/**
 * Kick Events webhook receiver (channel.followed).
 * Configure this exact URL in Kick Developer → Enable Webhooks.
 * Does not require Telegram auth; signature is verified with Kick public key.
 */
app.post(
  '/api/kick/webhooks',
  asyncHandler(async (req, res) => {
    const result = await handleKickFollowWebhook(req)
    res.status(result.status || (result.ok ? 200 : 400)).json({
      ok: Boolean(result.ok),
      ignored: Boolean(result.ignored),
      message: result.message || undefined,
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

/**
 * Wipe all Kick OAuth bindings / tokens / follow evidence (admin only).
 * Body optional: { "confirm": "RESET_KICK_BINDINGS" }
 */
app.post(
  '/api/admin/kick/reset',
  withAdmin(async (req, res) => {
    const confirm = String(req.body?.confirm || '').trim()
    if (confirm !== 'RESET_KICK_BINDINGS') {
      res.status(400).json({
        success: false,
        message: 'Передай confirm: "RESET_KICK_BINDINGS".',
      })
      return
    }

    const summary = withStore((store) => resetAllKickBindingsOnStore(store))
    console.info('[admin] kick bindings reset', summary)
    res.json({
      success: true,
      message: 'Все привязки Kick сброшены. Можно подключать аккаунты заново.',
      summary,
    })
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
    void bootstrapKickFollowInfrastructure().then((result) => {
      if (result?.ok) {
        console.info('[kick-follow] webhook subscription ready', {
          slug: result.channel?.slug,
          broadcasterUserId: result.channel?.broadcasterUserId,
        })
      } else if (result?.reason && result.reason !== 'kick_not_configured') {
        console.warn('[kick-follow] webhook bootstrap skipped/failed', {
          reason: result.reason,
        })
      }
    })
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
