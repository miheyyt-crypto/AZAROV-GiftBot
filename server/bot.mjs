import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Markup, Telegraf } from 'telegraf'

import { registerBotStart } from './referrals.mjs'
import { extractReferralCode } from './users.mjs'
import {
  answerPartnerCallback,
  handlePartnerModerationCallback,
  handlePartnerRejectReasonMessage,
} from './partner-admin.mjs'
import {
  answerShopCallback,
  handleShopModerationCallback,
  handleShopRejectReasonMessage,
} from './shop-admin.mjs'
import {
  answerGiveawayCallback,
  buildGiveawayStartAdminKeyboard,
  handleGiveawayAdminCallback,
  handleGiveawayCancelCommand,
  handleGiveawayWizardMessage,
  handleGiveawayWizardNonPhotoMedia,
  handleGiveawayWizardPhoto,
} from './giveaway-admin.mjs'
import {
  answerPromoCallback,
  handlePromoAdminCallback,
  handlePromoCancelCommand,
  handlePromoDeactivateCommand,
  handlePromoListCommand,
  handlePromoWizardMessage,
  startPromoCreateWizard,
} from './promo-admin.mjs'
import {
  answerWithdrawalCallback,
  handleWithdrawalModerationCallback,
} from './withdrawal-admin.mjs'
import {
  answerCommunityCallback,
  handleCommunityAdminCallback,
  handleCommunityAdminCommand,
  handleCommunityRejectReasonMessage,
} from './community-admin.mjs'
import { isAdminTelegramUser } from './telegram-notify.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: path.join(rootDir, '.env') })

/** Safe runtime snapshot for admin diagnostics (no tokens). */
let botRuntimeDiagnostics = {
  pollingActive: false,
  botId: null,
  botUsername: null,
  webhookUrlBeforeLaunch: null,
  webhookPendingUpdateCount: null,
  launchMode: null,
  lastLaunchError: null,
}

export function getBotRuntimeDiagnostics() {
  return { ...botRuntimeDiagnostics }
}

function mapTelegramUser(from) {
  if (!from?.id) {
    return null
  }

  return {
    id: from.id,
    username: from.username || '',
    first_name: from.first_name || '',
    last_name: from.last_name || '',
    language_code: from.language_code || '',
    is_premium: Boolean(from.is_premium),
    photo_url: '',
  }
}

const WELCOME_PHOTO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'assets',
  'welcome-start.jpg',
)

function buildWelcomeText() {
  return [
    '✨Добро пожаловать в AZAROV GIFTBOX!',
    '',
    'Смотри эфиры AZAROV на KICK, выполняй задания и копи монеты. Обменивай их в магазине на приветы, активности в эфире, подписки, пополнения и ценные призы.',
    '',
    'Не пропускай стримы, сохраняй серию и забирай ежедневные бонусы. Погнали фармить! 🎁',
  ].join('\n')
}

export function createBot() {
  const botToken = String(process.env.BOT_TOKEN || '').trim()
  const webappUrl = String(process.env.WEBAPP_URL || '').trim()

  if (!botToken) {
    console.error('[Telegram Bot] BOT_TOKEN is not configured.')
    return null
  }

  if (!webappUrl) {
    console.error('[Telegram Bot] WEBAPP_URL is not configured.')
  }

  const bot = new Telegraf(botToken)

  // TEMP DIAGNOSIS (remove after Welvura callback root-cause confirmed):
  // Top-level middleware — runs for every update before bot.action / bot.start.
  // Must call next() so existing handlers still run.
  bot.use(async (ctx, next) => {
    if (ctx.callbackQuery) {
      console.info('[Telegram Bot] DIAG callback_query received', {
        received: true,
        data: String(ctx.callbackQuery.data || '').slice(0, 80) || null,
        fromId: ctx.from?.id != null ? String(ctx.from.id) : null,
        updateId: ctx.update?.update_id ?? null,
      })
    }
    return next()
  })

  bot.start(async (ctx) => {
    const telegramUser = mapTelegramUser(ctx.from)
    if (!telegramUser) {
      return
    }

    const startPayload = String(ctx.startPayload || '').trim()

    try {
      const registered = registerBotStart(telegramUser, startPayload)
      console.info('[Telegram Bot] /start', {
        telegramId: registered.telegramId,
        username: ctx.from?.username || null,
        hasStartPayload: Boolean(startPayload),
      })
    } catch (error) {
      console.error('[Telegram Bot] Failed to register /start user', {
        telegramId: telegramUser.id,
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }

    const text = buildWelcomeText()
    let openUrl = webappUrl
    if (webappUrl && extractReferralCode(startPayload)) {
      const separator = webappUrl.includes('?') ? '&' : '?'
      openUrl = `${webappUrl}${separator}startapp=${encodeURIComponent(startPayload)}`
    }

    const keyboard = openUrl
      ? Markup.inlineKeyboard([Markup.button.webApp('ЗАПУСТИТЬ', openUrl)])
      : undefined

    try {
      const hasWelcomePhoto = existsSync(WELCOME_PHOTO_PATH)
      if (keyboard && hasWelcomePhoto) {
        await ctx.replyWithPhoto(
          { source: WELCOME_PHOTO_PATH },
          {
            caption: text,
            ...keyboard,
          },
        )
      } else if (keyboard) {
        console.warn('[Telegram Bot] Welcome photo missing, falling back to text /start', {
          path: WELCOME_PHOTO_PATH,
        })
        await ctx.reply(text, keyboard)
      } else if (hasWelcomePhoto) {
        await ctx.replyWithPhoto(
          { source: WELCOME_PHOTO_PATH },
          {
            caption: `${text}\n\n⚠ Mini App временно недоступен: WEBAPP_URL не настроен на сервере.`,
          },
        )
      } else {
        await ctx.reply(
          `${text}\n\n⚠ Mini App временно недоступен: WEBAPP_URL не настроен на сервере.`,
        )
      }

      if (isAdminTelegramUser(telegramUser.id)) {
        await ctx.reply('🛠 Админ-меню', {
          reply_markup: buildGiveawayStartAdminKeyboard(),
        })
      }
    } catch (error) {
      console.error('[Telegram Bot] Failed to reply to /start', {
        telegramId: telegramUser.id,
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  bot.command('admin', async (ctx) => {
    try {
      await handleCommunityAdminCommand(ctx)
    } catch (error) {
      console.error('[Telegram Bot] /admin failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  bot.command('cancel', async (ctx) => {
    try {
      const promoCancelled = await handlePromoCancelCommand(ctx)
      if (promoCancelled) {
        return
      }
      const handled = await handleGiveawayCancelCommand(ctx)
      if (!handled && isAdminTelegramUser(ctx.from?.id)) {
        await ctx.reply('Нечего отменять.')
      }
    } catch (error) {
      console.error('[Telegram Bot] /cancel failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  // Promo create (Cyrillic command + Latin aliases).
  async function onPromoCreateCommand(ctx) {
    try {
      await startPromoCreateWizard(ctx)
    } catch (error) {
      console.error('[Telegram Bot] promo create failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  bot.command('promo', onPromoCreateCommand)
  bot.command('promocode', onPromoCreateCommand)
  bot.hears(/^\/промокод(?:@\w+)?(?:\s|$)/i, onPromoCreateCommand)

  async function onPromoListCommand(ctx) {
    try {
      await handlePromoListCommand(ctx)
    } catch (error) {
      console.error('[Telegram Bot] promo list failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  bot.command('promocodes', onPromoListCommand)
  bot.hears(/^\/промокоды(?:@\w+)?(?:\s|$)/i, onPromoListCommand)

  bot.command('deactivate_promo', async (ctx) => {
    try {
      const raw = String(ctx.message?.text || '')
      const arg = raw.replace(/^\/deactivate_promo(?:@\w+)?/i, '').trim()
      await handlePromoDeactivateCommand(ctx, arg)
    } catch (error) {
      console.error('[Telegram Bot] deactivate_promo failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  // Temporary helper: reveal chat_id for KICK_NOTIFICATION_CHAT_ID setup.
  bot.command('chatid', async (ctx) => {
    try {
      if (!isAdminTelegramUser(ctx.from?.id)) {
        return
      }
      const chatId = ctx.chat?.id
      if (chatId == null) {
        await ctx.reply('Не удалось определить chat_id.')
        return
      }
      await ctx.reply(`🆔 Chat ID:\n${chatId}`)
    } catch (error) {
      console.error('[Telegram Bot] /chatid failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  // Preferred Telegraf path for inline buttons (reliably matches callback_data).
  async function onPartnerModerationAction(ctx) {
    try {
      console.info('[Telegram Bot] partner moderation action', {
        data: ctx.callbackQuery?.data || null,
        fromId: ctx.from?.id != null ? String(ctx.from.id) : null,
      })
      const handled = await handlePartnerModerationCallback(ctx)
      if (!handled) {
        await answerPartnerCallback(ctx)
      }
    } catch (error) {
      console.error('[Telegram Bot] partner moderation action failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      await answerPartnerCallback(ctx, 'Ошибка обработки', true)
    }
  }

  bot.action(/^vellur:(approve|reject):([0-9a-fA-F-]+)$/i, onPartnerModerationAction)
  bot.action(/^welvura:(approve|reject):([0-9a-fA-F-]+)$/i, onPartnerModerationAction)
  bot.action(/^partner:(approve|reject):([0-9a-fA-F-]+)$/i, onPartnerModerationAction)

  bot.action('vellur:noop', async (ctx) => {
    await answerPartnerCallback(ctx)
  })

  async function onShopModerationAction(ctx) {
    try {
      console.info('[Telegram Bot] shop moderation action', {
        data: ctx.callbackQuery?.data || null,
        fromId: ctx.from?.id != null ? String(ctx.from.id) : null,
      })
      const handled = await handleShopModerationCallback(ctx)
      if (!handled) {
        await answerShopCallback(ctx)
      }
    } catch (error) {
      console.error('[Telegram Bot] shop moderation action failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      await answerShopCallback(ctx, 'Ошибка обработки', true)
    }
  }

  bot.action(/^shop:(approve|reject):([A-Z0-9]{4,32})$/i, onShopModerationAction)
  bot.action('shop:noop', async (ctx) => {
    await answerShopCallback(ctx)
  })

  async function onWithdrawalModerationAction(ctx) {
    try {
      const handled = await handleWithdrawalModerationCallback(ctx)
      if (!handled) {
        await answerWithdrawalCallback(ctx)
      }
    } catch (error) {
      console.error('[Telegram Bot] withdrawal moderation action failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      await answerWithdrawalCallback(ctx, 'Ошибка обработки', true)
    }
  }

  bot.action(/^wd:(approve|reject):(WD-[A-Z0-9]{4,16})$/i, onWithdrawalModerationAction)
  bot.action('wd:noop', async (ctx) => {
    await answerWithdrawalCallback(ctx)
  })

  async function onCommunityAdminAction(ctx) {
    try {
      const handled = await handleCommunityAdminCallback(ctx)
      if (!handled) {
        await answerCommunityCallback(ctx)
      }
    } catch (error) {
      console.error('[Telegram Bot] community admin action failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      await answerCommunityCallback(ctx, 'Ошибка обработки', true)
    }
  }

  bot.action(/^ca:/i, onCommunityAdminAction)
  bot.action('admin:root', onCommunityAdminAction)

  async function onGiveawayAdminAction(ctx) {
    try {
      console.info('[Telegram Bot] giveaway admin action', {
        data: ctx.callbackQuery?.data || null,
        fromId: ctx.from?.id != null ? String(ctx.from.id) : null,
      })
      const handled = await handleGiveawayAdminCallback(ctx)
      if (!handled) {
        await answerGiveawayCallback(ctx)
      }
    } catch (error) {
      console.error('[Telegram Bot] giveaway admin action failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      await answerGiveawayCallback(ctx, 'Ошибка обработки', true)
    }
  }

  bot.action(/^gw:/i, onGiveawayAdminAction)

  async function onPromoAdminAction(ctx) {
    try {
      const handled = await handlePromoAdminCallback(ctx)
      if (!handled) {
        await answerPromoCallback(ctx)
      }
    } catch (error) {
      console.error('[Telegram Bot] promo admin action failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      await answerPromoCallback(ctx, 'Ошибка обработки', true)
    }
  }

  bot.action(/^promo:/i, onPromoAdminAction)

  bot.on('text', async (ctx) => {
    const raw = String(ctx.message?.text || '')
    // Ignore /commands — only consume plain text as wizard / rejection reasons.
    if (raw.startsWith('/')) {
      return
    }
    try {
      const promoHandled = await handlePromoWizardMessage(ctx)
      if (promoHandled) {
        return
      }
      const giveawayHandled = await handleGiveawayWizardMessage(ctx)
      if (giveawayHandled) {
        return
      }
      const communityRejectHandled = await handleCommunityRejectReasonMessage(ctx)
      if (communityRejectHandled) {
        return
      }
      const shopHandled = await handleShopRejectReasonMessage(ctx)
      if (shopHandled) {
        return
      }
      await handlePartnerRejectReasonMessage(ctx)
    } catch (error) {
      console.error('[Telegram Bot] text handler failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  bot.on('photo', async (ctx) => {
    try {
      await handleGiveawayWizardPhoto(ctx)
    } catch (error) {
      console.error('[Telegram Bot] photo handler failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  bot.on(['document', 'sticker', 'animation', 'video', 'audio', 'voice'], async (ctx) => {
    try {
      await handleGiveawayWizardNonPhotoMedia(ctx)
    } catch (error) {
      console.error('[Telegram Bot] media handler failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  bot.catch((error) => {
    console.error('[Telegram Bot] Unhandled error', {
      message: error instanceof Error ? error.message : 'unknown_error',
    })
  })

  return bot
}

/**
 * @param {{ registerSignals?: boolean }} [options]
 * When started from production.mjs, pass registerSignals: false so only one shutdown owner exists.
 */
export async function startBot(options = {}) {
  const registerSignals = options.registerSignals !== false
  const bot = createBot()
  if (!bot) {
    botRuntimeDiagnostics = {
      ...botRuntimeDiagnostics,
      pollingActive: false,
      launchMode: null,
      lastLaunchError: 'bot_token_missing_or_create_failed',
    }
    return null
  }

  try {
    // Probe Telegram before launch (safe fields only — no token).
    const me = await bot.telegram.getMe()
    const webhookInfo = await bot.telegram.getWebhookInfo()
    botRuntimeDiagnostics = {
      ...botRuntimeDiagnostics,
      botId: me?.id ?? null,
      botUsername: me?.username || null,
      webhookUrlBeforeLaunch: webhookInfo?.url || '',
      webhookPendingUpdateCount: webhookInfo?.pending_update_count ?? null,
      launchMode: 'polling',
      lastLaunchError: null,
    }
    console.info('[Telegram Bot] DIAG getMe', {
      id: me?.id ?? null,
      username: me?.username || null,
    })
    console.info('[Telegram Bot] DIAG getWebhookInfo', {
      url: webhookInfo?.url || '',
      pendingUpdateCount: webhookInfo?.pending_update_count ?? null,
      allowedUpdates: webhookInfo?.allowed_updates ?? null,
      lastErrorDate: webhookInfo?.last_error_date ?? null,
      lastErrorMessage: webhookInfo?.last_error_message
        ? String(webhookInfo.last_error_message).slice(0, 200)
        : null,
      maxConnections: webhookInfo?.max_connections ?? null,
    })

    // Long polling only — Telegraf deletes any existing webhook before getUpdates.
    // Explicitly include callback_query so moderation buttons always deliver.
    await bot.launch({
      dropPendingUpdates: true,
      allowedUpdates: ['message', 'callback_query'],
    })
    botRuntimeDiagnostics = {
      ...botRuntimeDiagnostics,
      pollingActive: true,
      launchMode: 'polling',
      lastLaunchError: null,
    }
    console.info('[Telegram Bot] Long polling started', {
      allowedUpdates: ['message', 'callback_query'],
      dropPendingUpdates: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error'
    botRuntimeDiagnostics = {
      ...botRuntimeDiagnostics,
      pollingActive: false,
      lastLaunchError: message.slice(0, 200),
    }
    console.error('[Telegram Bot] Failed to start long polling', {
      message,
    })
    return null
  }

  if (registerSignals) {
    process.once('SIGINT', () => bot.stop('SIGINT'))
    process.once('SIGTERM', () => bot.stop('SIGTERM'))
  }

  return bot
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  void startBot()
}
