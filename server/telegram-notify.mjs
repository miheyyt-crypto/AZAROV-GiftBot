import { readFileSync } from 'node:fs'

/**
 * Lightweight Telegram Bot API helpers (no Telegraf dependency).
 * Used by API process to notify admins/users about partner submissions.
 */

export function getBotToken() {
  return String(process.env.BOT_TOKEN || '').trim()
}

/**
 * Parse comma/space/semicolon-separated Telegram IDs into digit strings.
 * Keeps precision for large IDs (no Number()).
 */
export function parseTelegramIdList(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter((part) => /^-?\d+$/.test(part))
}

/** Telegram user IDs allowed to moderate partner submissions via bot buttons. */
export function getAdminTelegramIds() {
  return parseTelegramIdList(process.env.ADMIN_TELEGRAM_IDS)
}

/**
 * Chat where new submissions are posted.
 * Falls back to DMing each ADMIN_TELEGRAM_IDS entry when empty.
 */
export function getAdminNotifyChatIds() {
  const chatId = String(process.env.ADMIN_CHAT_ID || '')
    .trim()
    .replace(/^["']|["']$/g, '')
  if (chatId && /^-?\d+$/.test(chatId)) {
    return [chatId]
  }
  return getAdminTelegramIds()
}

export function isAdminTelegramUser(telegramUserId) {
  const id = String(telegramUserId ?? '').trim()
  if (!/^-?\d+$/.test(id)) {
    return false
  }
  return getAdminTelegramIds().includes(id)
}

export async function telegramApi(method, payload, options = {}) {
  const token = getBotToken()
  if (!token) {
    return { ok: false, error: 'bot_token_missing' }
  }

  const fetchImpl = options.fetchImpl || fetch
  const url = `https://api.telegram.org/bot${token}/${method}`

  let response
  try {
    if (payload instanceof FormData) {
      response = await fetchImpl(url, { method: 'POST', body: payload })
    } else {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload || {}),
      })
    }
  } catch (error) {
    return {
      ok: false,
      error: 'network_error',
      message: error instanceof Error ? error.message : 'network_error',
    }
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok || !body?.ok) {
    const retryAfterRaw = body?.parameters?.retry_after
    const retryAfter = Number(retryAfterRaw)
    return {
      ok: false,
      error: 'telegram_api_error',
      status: response.status,
      description: body?.description || null,
      errorCode: body?.error_code == null ? null : Number(body.error_code),
      retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    }
  }

  return { ok: true, result: body.result }
}

export async function sendTelegramMessage(chatId, text, extra = {}, options = {}) {
  return telegramApi(
    'sendMessage',
    {
      chat_id: chatId,
      text,
      parse_mode: extra.parse_mode === undefined ? 'HTML' : extra.parse_mode,
      disable_web_page_preview: true,
      ...extra,
    },
    options,
  )
}

/**
 * Copy an existing Telegram message to another chat (preserves media + entities).
 */
export async function copyTelegramMessage(toChatId, fromChatId, messageId, extra = {}, options = {}) {
  return telegramApi(
    'copyMessage',
    {
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
      ...extra,
    },
    options,
  )
}

export async function sendTelegramPhoto(chatId, absolutePath, caption, extra = {}, options = {}) {
  const buffer = readFileSync(absolutePath)
  const form = new FormData()
  form.append('chat_id', String(chatId))
  if (caption) {
    form.append('caption', caption)
    form.append('parse_mode', 'HTML')
  }
  form.append('photo', new Blob([buffer]), 'screenshot.jpg')
  if (extra.reply_markup) {
    form.append('reply_markup', JSON.stringify(extra.reply_markup))
  }
  if (extra.reply_to_message_id != null) {
    form.append('reply_to_message_id', String(extra.reply_to_message_id))
  }
  return telegramApi('sendPhoto', form, options)
}

export async function answerTelegramCallback(callbackQueryId, text = '', options = {}) {
  return telegramApi(
    'answerCallbackQuery',
    {
      callback_query_id: callbackQueryId,
      text: String(text || '').slice(0, 200),
      show_alert: Boolean(options.showAlert),
    },
    options,
  )
}

export async function editTelegramReplyMarkup(chatId, messageId, replyMarkup = { inline_keyboard: [] }, options = {}) {
  return telegramApi(
    'editMessageReplyMarkup',
    {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    },
    options,
  )
}

export async function editTelegramMessageText(chatId, messageId, text, extra = {}, options = {}) {
  return telegramApi(
    'editMessageText',
    {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: extra.parse_mode === undefined ? 'HTML' : extra.parse_mode,
      disable_web_page_preview: true,
      ...extra,
    },
    options,
  )
}
