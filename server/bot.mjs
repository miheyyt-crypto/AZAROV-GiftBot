import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Markup, Telegraf } from 'telegraf'

import { registerBotStart } from './referrals.mjs'
import { extractReferralCode } from './users.mjs'
import {
  handlePartnerModerationCallback,
  handlePartnerRejectReasonMessage,
} from './partner-admin.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: path.join(rootDir, '.env') })

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

function buildWelcomeText(firstName) {
  const name = String(firstName || '').trim() || 'друг'
  return [
    `Привет, ${name}! 👋`,
    '',
    'Добро пожаловать в AZAROV GiftBot.',
    '',
    'Здесь ты можешь выполнять задания, получать монеты, приглашать друзей, открывать кейсы и обменивать монеты на награды.',
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

    const text = buildWelcomeText(ctx.from?.first_name)
    let openUrl = webappUrl
    if (webappUrl && extractReferralCode(startPayload)) {
      const separator = webappUrl.includes('?') ? '&' : '?'
      openUrl = `${webappUrl}${separator}startapp=${encodeURIComponent(startPayload)}`
    }

    const keyboard = openUrl
      ? Markup.inlineKeyboard([Markup.button.webApp('🎁 Открыть GiftBot', openUrl)])
      : undefined

    try {
      if (keyboard) {
        await ctx.reply(text, keyboard)
      } else {
        await ctx.reply(
          `${text}\n\n⚠ Mini App временно недоступен: WEBAPP_URL не настроен на сервере.`,
        )
      }
    } catch (error) {
      console.error('[Telegram Bot] Failed to reply to /start', {
        telegramId: telegramUser.id,
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  })

  bot.on('callback_query', async (ctx) => {
    try {
      const handled = await handlePartnerModerationCallback(ctx)
      if (!handled && ctx.callbackQuery?.id) {
        await ctx.answerCbQuery().catch(() => {})
      }
    } catch (error) {
      console.error('[Telegram Bot] callback_query failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      try {
        await ctx.answerCbQuery('Ошибка обработки').catch(() => {})
      } catch {
        // ignore
      }
    }
  })

  bot.on('text', async (ctx) => {
    // Ignore /commands — only consume plain text as rejection reasons.
    if (String(ctx.message?.text || '').startsWith('/')) {
      return
    }
    try {
      await handlePartnerRejectReasonMessage(ctx)
    } catch (error) {
      console.error('[Telegram Bot] reject-reason text failed', {
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
    return null
  }

  try {
    await bot.launch({
      dropPendingUpdates: true,
    })
    console.info('[Telegram Bot] Long polling started')
  } catch (error) {
    console.error('[Telegram Bot] Failed to start long polling', {
      message: error instanceof Error ? error.message : 'unknown_error',
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
