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
import {
  adminCompleteKickFollow,
  adminRefreshKickFollowSubscription,
  checkKickFollow,
  getKickFollowAdminStatus,
  handleKickFollowWebhook,
} from './kick-follow.mjs'
import { checkKickNickname } from './kick-nickname.mjs'
import { getKickStreakForUser } from './kick-streak.mjs'
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
import {
  notifyAdminsNewPartnerSubmission,
  notifyUserPartnerDecision,
} from './partner-admin.mjs'
import {
  approveCommunityAccess,
  createCommunityAccessRequest,
  getAdminCommunityRequest,
  getCommunityAccessStatus,
  getCommunityScreenshot,
  listAdminCommunityAccess,
  parseCommunityRequestId,
  rejectCommunityAccess,
} from './community-access.mjs'
import {
  notifyAdminsNewCommunityAccess,
  notifyUserCommunityDecision,
} from './community-admin.mjs'
import {
  notifyAdminsNewShopOrder,
  notifyUserShopDecision,
} from './shop-admin.mjs'
import { notifyAdminsNewWithdrawal } from './withdrawal-admin.mjs'
import { createWithdrawal } from './withdrawals.mjs'
import { getBotRuntimeDiagnostics } from './bot.mjs'
import { telegramApi } from './telegram-notify.mjs'
import { listPartnersPublic } from './partners.mjs'
import { MAX_SCREENSHOT_BYTES, isForbiddenOriginalName } from './uploads.mjs'
import {
  approveShopOrder,
  cancelOrder,
  getOrder,
  getUserOrders,
  listShopOrdersForAdmin,
  purchaseProduct,
  rejectShopOrder,
} from './shop.mjs'
import { openCase } from './cases.mjs'
import {
  cashoutMines,
  getActiveMinesGame,
  revealMinesCell,
  startMinesGame,
} from './mines.mjs'
import {
  cashoutTower,
  getActiveTowerGame,
  pickTowerCell,
  startTowerGame,
} from './tower.mjs'
import { redeemPromoCode } from './promo.mjs'
import {
  getUnreadNotificationsCount,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications.mjs'
import {
  createGiveaway,
  deleteGiveaway,
  finalizeGiveaway,
  getGiveaway,
  listAdminGiveaways,
  listGiveaways,
  notifyGiveawayTelegramJobs,
  participateGiveaway,
  parseGiveawayId,
  peekGiveaway,
  startGiveawayScheduler,
  updateGiveaway,
} from './giveaways.mjs'
import { fetchTelegramFileById } from './telegram-files.mjs'
import { getLeaderboard, getRecentCaseDrops } from './home.mjs'
import {
  getAchievementsProgress,
  getCoinHistory,
  getInventory,
  getPendingOrders,
  claimAchievement,
} from './profile.mjs'
import {
  assertPersistentStoreOrExit,
  getStoreDiagnostics,
  getUser,
  persistStoreMigrations,
  withStore,
} from './store.mjs'
import {
  assertSingleReplicaDeployment,
  getDeploymentReplicaDiagnostics,
} from './deploy-safety.mjs'
import {
  assertNoClientFinancialOverrides,
  parseAchievementId,
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
assertSingleReplicaDeployment({ isProduction: IS_PRODUCTION })

const adminAuthLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 })
const partnerUploadLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10 })
const webLoginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 })
/** Per authenticated user — spam/DoS only; does not replace ledger idempotency. */
const economicMutationLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 45 })

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

/**
 * Authenticated user + soft per-user rate limit for economy-changing mutations.
 * Idempotency / ledger remain the source of truth for duplicate rewards.
 */
function withEconomicUser(handler) {
  return withUser(async (req, res, telegramUser) => {
    const limit = economicMutationLimiter.check(`econ:${telegramUser.id}`)
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000) || 1))
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        message: 'Слишком много запросов. Подожди немного и попробуй снова.',
      })
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
  const deploy = getDeploymentReplicaDiagnostics()
  res.json({
    ok: true,
    store: {
      persistent: store.persistent,
      source: store.source,
      exists: store.exists,
      backupExists: store.backupExists,
      usersCount: store.usersCount,
      multiReplicaSafe: false,
      singleReplicaRequired: deploy.singleReplicaRequired,
      ...(store.error ? { error: store.error } : {}),
    },
    deploy: {
      multiReplicaSafe: false,
      singleReplicaRequired: deploy.singleReplicaRequired,
      railwayReplicaId: deploy.railwayReplicaId,
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
 * Kick chat-activity streak for the authenticated Mini App user.
 * Source of truth is backend (webhook credits); never trust client Kick ids.
 */
app.get(
  '/api/kick/streak',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const streak = getKickStreakForUser(telegramUser.id)
    res.json({
      ...streak,
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
      levelRewards: result.levelRewards?.granted?.length
        ? {
            granted: result.levelRewards.granted,
            totalAmount: result.levelRewards.totalAmount,
            level: result.levelRewards.level,
          }
        : null,
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
      levelRewards: result.levelRewards?.granted?.length
        ? {
            granted: result.levelRewards.granted,
            totalAmount: result.levelRewards.totalAmount,
            level: result.levelRewards.level,
          }
        : null,
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
  withEconomicUser(async (req, res, telegramUser) => {
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
  withEconomicUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = await checkKickFollow(telegramUser.id, requestId)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/tasks/kick-nickname/check',
  withEconomicUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = await checkKickNickname(telegramUser.id, requestId)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

/**
 * Kick Events webhook receiver (channel.followed, chat.message.sent, livestream.status.updated).
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
  withEconomicUser(async (req, res, telegramUser) => {
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
  withEconomicUser(async (_req, res, telegramUser) => {
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
  withEconomicUser(async (req, res, telegramUser) => {
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

    const econLimit = economicMutationLimiter.check(`econ:${telegramUser.id}`)
    if (!econLimit.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(econLimit.retryAfterMs / 1000) || 1))
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        message: 'Слишком много запросов. Подожди немного и попробуй снова.',
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

    if (result.success && result.submission?.status === 'pending') {
      void notifyAdminsNewPartnerSubmission(result.submission).catch((error) => {
        console.error('[partner-admin] notify failed', {
          submissionId: result.submission?.submissionId,
          message: error instanceof Error ? error.message : 'unknown_error',
        })
      })
    }

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
  '/api/community-access/status',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = getCommunityAccessStatus(telegramUser.id)
    res.json({
      success: true,
      request: result.request || null,
      canSubmit: Boolean(result.canSubmit),
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/community-access/request',
  asyncHandler(async (req, res, next) => {
    const telegramUser = requireTelegramUser(req, res)
    if (!telegramUser) {
      return
    }

    const limit = partnerUploadLimiter.check(`community-upload:${telegramUser.id}`)
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000) || 1))
      res.status(429).json({
        success: false,
        message: 'Слишком много загрузок. Подожди немного.',
      })
      return
    }

    const econLimit = economicMutationLimiter.check(`econ:${telegramUser.id}`)
    if (!econLimit.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(econLimit.retryAfterMs / 1000) || 1))
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        message: 'Слишком много запросов. Подожди немного и попробуй снова.',
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
    bootstrapUser(telegramUser, '')

    const result = createCommunityAccessRequest(
      telegramUser,
      {
        welvuraId: req.body?.welvuraId,
        username: req.body?.username,
        requestId: req.body?.requestId,
      },
      req.file,
    )

    if (result.success && result.request?.status === 'pending' && !result.alreadyExists) {
      void notifyAdminsNewCommunityAccess(result.request, {
        absolutePath: result._absoluteScreenshotPath || null,
      }).catch((error) => {
        console.error('[community-admin] notify failed', {
          requestId: result.request?.id,
          message: error instanceof Error ? error.message : 'unknown_error',
        })
      })
    }

    const { _absoluteScreenshotPath: _omit, ...safeResult } = result
    void _omit
    res.json({
      ...safeResult,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/admin/community-access',
  withAdmin(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : ''
    const result = listAdminCommunityAccess(status)
    res.json(result)
  }),
)

app.get(
  '/api/admin/community-access/:requestId',
  withAdmin(async (req, res) => {
    const result = getAdminCommunityRequest(req.params.requestId)
    const status = result.success ? 200 : 404
    res.status(status).json(result)
  }),
)

app.get(
  '/api/admin/community-access/:requestId/screenshot',
  withAdmin(async (req, res) => {
    const result = getCommunityScreenshot(String(req.params.requestId || ''), { isAdmin: true })
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
  '/api/admin/community-access/:requestId/approve',
  withAdmin(async (req, res) => {
    const id = parseCommunityRequestId(req.params.requestId)
    if (!id) {
      res.status(400).json({ success: false, message: 'Некорректный id заявки.' })
      return
    }
    const result = approveCommunityAccess(id, 'admin-key')
    if (result.success && !result.alreadyReviewed) {
      void notifyUserCommunityDecision(result.request)
    }
    res.status(result.success ? 200 : result.code === 'NOT_FOUND' ? 404 : 400).json(result)
  }),
)

app.post(
  '/api/admin/community-access/:requestId/reject',
  withAdmin(async (req, res) => {
    const id = parseCommunityRequestId(req.params.requestId)
    if (!id) {
      res.status(400).json({ success: false, message: 'Некорректный id заявки.' })
      return
    }
    const result = rejectCommunityAccess(id, 'admin-key', req.body?.reason)
    if (result.success && !result.alreadyReviewed) {
      void notifyUserCommunityDecision(result.request)
    }
    res.status(result.success ? 200 : result.code === 'NOT_FOUND' ? 404 : 400).json(result)
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
  '/api/admin/kick/status',
  withAdmin(async (_req, res) => {
    const status = await getKickFollowAdminStatus()
    res.json({ success: true, status })
  }),
)

/**
 * TEMP DIAGNOSIS — Telegram bot delivery path (no tokens in response).
 * Confirms getMe / getWebhookInfo and whether this process has Telegraf polling.
 */
app.get(
  '/api/admin/telegram/bot-diag',
  withAdmin(async (_req, res) => {
    const runtime = getBotRuntimeDiagnostics()
    const me = await telegramApi('getMe')
    const webhook = await telegramApi('getWebhookInfo')
    const meResult = me.ok ? me.result : null
    const whResult = webhook.ok ? webhook.result : null

    console.info('[admin] telegram bot-diag', {
      pollingActive: runtime.pollingActive,
      launchMode: runtime.launchMode,
      botUsername: meResult?.username || runtime.botUsername || null,
      webhookUrl: whResult?.url || '',
      pendingUpdateCount: whResult?.pending_update_count ?? null,
    })

    res.json({
      success: true,
      process: {
        entryHint: runtime.pollingActive
          ? 'telegraf_polling_active_in_this_process'
          : 'no_telegraf_polling_in_this_process',
        ...runtime,
      },
      telegram: {
        getMeOk: Boolean(me.ok),
        getMeError: me.ok ? null : me.error || me.description || null,
        botId: meResult?.id ?? null,
        botUsername: meResult?.username || null,
        getWebhookInfoOk: Boolean(webhook.ok),
        getWebhookInfoError: webhook.ok
          ? null
          : webhook.error || webhook.description || null,
        webhookUrl: whResult?.url || '',
        pendingUpdateCount: whResult?.pending_update_count ?? null,
        webhookAllowedUpdates: whResult?.allowed_updates ?? null,
        lastErrorDate: whResult?.last_error_date ?? null,
        lastErrorMessage: whResult?.last_error_message
          ? String(whResult.last_error_message).slice(0, 200)
          : null,
      },
      interpretation: {
        modeExpectedByCode: 'long_polling',
        webhookConfigured: Boolean(whResult?.url),
        note: 'callback_query never appears as Express HTTP when using polling — look for DIAG callback_query / Long polling started logs instead.',
      },
    })
  }),
)

app.post(
  '/api/admin/kick/follow/subscribe',
  withAdmin(async (_req, res) => {
    const result = await adminRefreshKickFollowSubscription()
    res.json({
      success: Boolean(result?.ok),
      result,
      message: result?.ok
        ? 'Подписка на channel.followed обновлена.'
        : 'Не удалось подписаться на webhook Kick.',
    })
  }),
)

app.post(
  '/api/admin/kick/follow/complete',
  withAdmin(async (req, res) => {
    const telegramUserId = Number(req.body?.telegramUserId)
    const confirm = String(req.body?.confirm || '').trim()
    if (confirm !== 'COMPLETE_KICK_FOLLOW') {
      res.status(400).json({
        success: false,
        message: 'Передай confirm: "COMPLETE_KICK_FOLLOW".',
      })
      return
    }

    const result = await adminCompleteKickFollow(telegramUserId)
    res.status(result.success ? 200 : 400).json(result)
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
    if (result.success && result.submission?.status === 'approved') {
      void notifyUserPartnerDecision(result.submission).catch((error) => {
        console.error('[partner-admin] approve HTTP notify failed', {
          submissionId: result.submission?.submissionId,
          message: error instanceof Error ? error.message : 'unknown_error',
        })
      })
    }
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
    if (result.success && result.submission?.status === 'rejected') {
      void notifyUserPartnerDecision(result.submission).catch((error) => {
        console.error('[partner-admin] reject HTTP notify failed', {
          submissionId: result.submission?.submissionId,
          message: error instanceof Error ? error.message : 'unknown_error',
        })
      })
    }
    res.json(result)
  }),
)

app.get(
  '/api/admin/shop/orders',
  withAdmin(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : ''
    const result = listShopOrdersForAdmin(status)
    res.json(result)
  }),
)

app.post(
  '/api/admin/shop/orders/:orderId/approve',
  withAdmin(async (req, res) => {
    const orderId = parseOrderId(req.params.orderId)
    const requestId =
      typeof req.body?.requestId === 'string' && req.body.requestId.trim()
        ? parseRequestId(req.body.requestId)
        : `admin-shop-approve-${Date.now()}`
    const result = approveShopOrder(orderId, 'admin-key', requestId)
    if (result.success && result.order?.status === 'completed' && !result.alreadyProcessed) {
      void notifyUserShopDecision(result.order).catch((error) => {
        console.error('[shop-admin] approve HTTP notify failed', {
          orderId: result.order?.orderId,
          message: error instanceof Error ? error.message : 'unknown_error',
        })
      })
    }
    res.json(result)
  }),
)

app.post(
  '/api/admin/shop/orders/:orderId/reject',
  withAdmin(async (req, res) => {
    const orderId = parseOrderId(req.params.orderId)
    const requestId =
      typeof req.body?.requestId === 'string' && req.body.requestId.trim()
        ? parseRequestId(req.body.requestId)
        : `admin-shop-reject-${Date.now()}`
    const rejectionReason =
      typeof req.body?.rejectionReason === 'string' ? req.body.rejectionReason : ''
    const result = rejectShopOrder(orderId, 'admin-key', rejectionReason, requestId)
    if (result.success && result.order?.status === 'rejected' && !result.alreadyProcessed) {
      void notifyUserShopDecision(result.order).catch((error) => {
        console.error('[shop-admin] reject HTTP notify failed', {
          orderId: result.order?.orderId,
          message: error instanceof Error ? error.message : 'unknown_error',
        })
      })
    }
    res.json(result)
  }),
)

app.post(
  '/api/shop/purchase',
  withEconomicUser(async (req, res, telegramUser) => {
    const productId = parseProductId(req.body?.productId)
    const requestId = parseRequestId(req.body?.requestId)
    const metadata = sanitizePurchaseMetadata(req.body?.metadata)
    bootstrapUser(telegramUser, '')
    const result = purchaseProduct(telegramUser.id, productId, requestId, metadata)
    if (result.success && result.created && result.order?.status === 'pending') {
      void notifyAdminsNewShopOrder(result.order).catch((error) => {
        console.error('[shop-admin] purchase notify failed', {
          orderId: result.order?.orderId,
          message: error instanceof Error ? error.message : 'unknown_error',
        })
      })
    }
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

app.post(
  '/api/achievements/:achievementId/claim',
  withUser(async (req, res, telegramUser) => {
    const achievementId = parseAchievementId(req.params.achievementId)
    bootstrapUser(telegramUser, '')
    const result = claimAchievement(telegramUser.id, achievementId)
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

app.get(
  '/api/notifications',
  withUser(async (req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const limitRaw = Number(req.query?.limit)
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50
    const result = listNotificationsForUser(telegramUser.id, { limit })
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/notifications/unread-count',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = getUnreadNotificationsCount(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/notifications/read-all',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = markAllNotificationsRead(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/notifications/:notificationId/read',
  withUser(async (req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const notificationId = String(req.params.notificationId || '').trim()
    const result = markNotificationRead(telegramUser.id, notificationId)
    res.status(result.success ? 200 : result.code === 'NOT_FOUND' ? 404 : 400).json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/giveaways',
  withUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = listGiveaways({ userId: telegramUser.id })
    if (result.telegramJobs?.length) {
      void notifyGiveawayTelegramJobs(result.telegramJobs)
    }
    res.json({
      success: true,
      giveaways: result.giveaways || [],
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/giveaways/:giveawayId',
  withUser(async (req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const giveawayId = parseGiveawayId(req.params.giveawayId)
    if (!giveawayId) {
      res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Некорректный id розыгрыша.',
      })
      return
    }
    const result = getGiveaway(giveawayId, { userId: telegramUser.id })
    if (result.telegramJobs?.length) {
      void notifyGiveawayTelegramJobs(result.telegramJobs)
    }
    if (!result.success) {
      res.status(result.code === 'NOT_FOUND' ? 404 : 400).json({
        success: false,
        code: result.code,
        message: result.message,
        user: toPublicUser(getUser(telegramUser.id)),
      })
      return
    }
    res.json({
      success: true,
      giveaway: result.giveaway,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

/**
 * Public image proxy for giveaway custom photos (Telegram file_id).
 * No BOT_TOKEN in response. Auth not required so <img src> works in Mini App.
 */
app.get(
  '/api/giveaways/:giveawayId/image',
  asyncHandler(async (req, res) => {
    const giveawayId = parseGiveawayId(req.params.giveawayId)
    if (!giveawayId) {
      res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Некорректный id розыгрыша.',
      })
      return
    }

    const row = peekGiveaway(giveawayId)
    if (!row) {
      res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Розыгрыш не найден.',
      })
      return
    }

    const fileId = row.imageFileId != null ? String(row.imageFileId).trim() : ''
    if (!fileId) {
      res.status(404).json({
        success: false,
        code: 'NO_IMAGE',
        message: 'У розыгрыша нет изображения.',
      })
      return
    }

    const file = await fetchTelegramFileById(fileId)
    if (!file.ok || !file.buffer) {
      res.status(502).json({
        success: false,
        code: 'TELEGRAM_FILE_ERROR',
        message: 'Не удалось загрузить изображение.',
      })
      return
    }

    res.setHeader('Content-Type', file.contentType || 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=3600, immutable')
    res.send(file.buffer)
  }),
)

app.post(
  '/api/giveaways/:giveawayId/participate',
  withEconomicUser(async (req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const giveawayId = parseGiveawayId(req.params.giveawayId)
    if (!giveawayId) {
      res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Некорректный id розыгрыша.',
      })
      return
    }
    const result = participateGiveaway(giveawayId, telegramUser.id)
    if (result.telegramJobs?.length) {
      void notifyGiveawayTelegramJobs(result.telegramJobs)
    }
    if (!result.success) {
      const status =
        result.code === 'NOT_FOUND'
          ? 404
          : result.code === 'ENDED' || result.code === 'NOT_ACTIVE' || result.code === 'NOT_STARTED'
            ? 409
            : result.code === 'GIVEAWAY_NOT_ELIGIBLE'
              ? 403
              : 400
      res.status(status).json({
        success: false,
        code: result.code,
        message: result.message,
        ...(result.requirement ? { requirement: result.requirement } : {}),
        ...(Array.isArray(result.missing) ? { missing: result.missing } : {}),
        ...(result.giveaway ? { giveaway: result.giveaway } : {}),
        user: toPublicUser(getUser(telegramUser.id)),
      })
      return
    }
    res.json({
      success: true,
      participating: true,
      alreadyParticipating: Boolean(result.alreadyParticipating),
      participantsCount: result.participantsCount,
      giveaway: result.giveaway,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/admin/giveaways',
  withAdmin(async (_req, res) => {
    const result = listAdminGiveaways()
    if (result.telegramJobs?.length) {
      void notifyGiveawayTelegramJobs(result.telegramJobs)
    }
    res.json({ success: true, giveaways: result.giveaways })
  }),
)

app.post(
  '/api/admin/giveaways',
  withAdmin(async (req, res) => {
    const result = createGiveaway(req.body || {}, { createdBy: 'admin-key' })
    res.status(result.success ? 201 : 400).json(result)
  }),
)

app.patch(
  '/api/admin/giveaways/:giveawayId',
  withAdmin(async (req, res) => {
    const giveawayId = parseGiveawayId(req.params.giveawayId)
    if (!giveawayId) {
      res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Некорректный id розыгрыша.',
      })
      return
    }
    const result = updateGiveaway(giveawayId, req.body || {})
    const status = result.success ? 200 : result.code === 'NOT_FOUND' ? 404 : 400
    res.status(status).json(result)
  }),
)

app.delete(
  '/api/admin/giveaways/:giveawayId',
  withAdmin(async (req, res) => {
    const giveawayId = parseGiveawayId(req.params.giveawayId)
    if (!giveawayId) {
      res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Некорректный id розыгрыша.',
      })
      return
    }
    const result = deleteGiveaway(giveawayId)
    const status = result.success
      ? 200
      : result.code === 'NOT_FOUND'
        ? 404
        : result.code === 'HAS_PARTICIPANTS' || result.code === 'IMMUTABLE'
          ? 409
          : 400
    res.status(status).json(result)
  }),
)

app.post(
  '/api/admin/giveaways/:giveawayId/complete',
  withAdmin(async (req, res) => {
    const giveawayId = parseGiveawayId(req.params.giveawayId)
    if (!giveawayId) {
      res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Некорректный id розыгрыша.',
      })
      return
    }
    const result = finalizeGiveaway(giveawayId)
    if (result.telegramJobs?.length) {
      void notifyGiveawayTelegramJobs(result.telegramJobs)
    }
    const status = result.success ? 200 : result.code === 'NOT_FOUND' ? 404 : 400
    res.status(status).json({
      success: result.success,
      alreadyCompleted: Boolean(result.alreadyCompleted),
      giveaway: result.giveaway,
      code: result.code,
      message: result.message,
    })
  }),
)

app.post(
  '/api/cases/open',
  withEconomicUser(async (req, res, telegramUser) => {
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

app.get(
  '/api/mines/active',
  withEconomicUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = getActiveMinesGame(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/mines/start',
  withEconomicUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = startMinesGame(telegramUser.id, {
      bet: req.body?.bet,
      mineCount: req.body?.mineCount,
      requestId,
    })
    res.status(result.success ? 200 : 400).json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/mines/reveal',
  withEconomicUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = revealMinesCell(telegramUser.id, {
      gameId: req.body?.gameId,
      cellIndex: req.body?.cellIndex,
      requestId,
    })
    res.status(result.success ? 200 : 400).json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/mines/cashout',
  withEconomicUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = cashoutMines(telegramUser.id, {
      gameId: req.body?.gameId,
      requestId,
    })
    res.status(result.success ? 200 : 400).json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.get(
  '/api/tower/active',
  withEconomicUser(async (_req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = getActiveTowerGame(telegramUser.id)
    res.json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/tower/start',
  withEconomicUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = startTowerGame(telegramUser.id, {
      bet: req.body?.bet,
      requestId,
    })
    res.status(result.success ? 200 : 400).json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/tower/pick',
  withEconomicUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = pickTowerCell(telegramUser.id, {
      gameId: req.body?.gameId,
      floor: req.body?.floor,
      cellIndex: req.body?.cellIndex,
      requestId,
    })
    res.status(result.success ? 200 : 400).json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/tower/cashout',
  withEconomicUser(async (req, res, telegramUser) => {
    const requestId = parseRequestId(req.body?.requestId)
    bootstrapUser(telegramUser, '')
    const result = cashoutTower(telegramUser.id, {
      gameId: req.body?.gameId,
      requestId,
    })
    res.status(result.success ? 200 : 400).json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/promo/redeem',
  withEconomicUser(async (req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = redeemPromoCode(telegramUser.id, req.body?.code)
    res.status(result.success ? 200 : 400).json({
      ...result,
      user: toPublicUser(getUser(telegramUser.id)),
    })
  }),
)

app.post(
  '/api/withdrawals/create',
  withEconomicUser(async (req, res, telegramUser) => {
    bootstrapUser(telegramUser, '')
    const result = createWithdrawal(telegramUser.id, {
      itemId: req.body?.itemId,
      walletAddress: req.body?.walletAddress,
    })
    if (result.success && result.withdrawal) {
      void notifyAdminsNewWithdrawal(result.withdrawal).catch((error) => {
        console.error('[withdrawal-admin] create notify failed', {
          message: error instanceof Error ? error.message : 'unknown_error',
        })
      })
    }
    res.status(result.success ? 200 : 400).json({
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
  try {
    const migration = persistStoreMigrations()
    if (migration && !migration.alreadyDone && migration.migrated > 0) {
      console.info('[store] migrated legacy streak-freeze orders to inventory', migration)
    }
  } catch (error) {
    console.error('[store] migration failed', {
      message: error instanceof Error ? error.message : 'unknown_error',
    })
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`AZAROV GiftBot API listening on http://${HOST}:${PORT}`)
    if (canServeFrontend) {
      console.log(`[boot] Serving frontend from ${distDir}`)
    }
    startGiveawayScheduler()
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
