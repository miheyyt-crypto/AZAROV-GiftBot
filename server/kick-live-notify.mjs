/**
 * Telegram notify when the required Kick channel goes OFFLINE → LIVE.
 * Uses existing livestream.status.updated webhook path — no second Kick client.
 * Fans out to all bot users (broadcast recipients) with rate limits + Kick link preview.
 */

import {
  getKickRequiredChannel,
  getKickRequiredChannelUrl,
} from './constants.mjs'
import {
  BROADCAST_RATE_LIMIT_PER_SEC,
  listBroadcastRecipients,
} from './broadcasts.mjs'
import {
  forgetKickWebhookMemoryKey,
  hasKickWebhookEvent,
  markKickWebhookEventProcessed,
} from './kick-streak.mjs'
import { withStore, withStoreRead } from './store.mjs'
import { parseTelegramIdList, sendTelegramMessage } from './telegram-notify.mjs'

/** Process-local: first livestream observation after boot never notifies. */
let liveStatusObservedThisProcess = false

export function resetKickLiveNotifyBootstrapForTests() {
  liveStatusObservedThisProcess = false
}

export function getKickNotificationChannel() {
  const raw = String(process.env.KICK_NOTIFICATION_CHANNEL || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
  return raw || getKickRequiredChannel()
}

export function getKickNotificationChannelUrl() {
  return `https://kick.com/${getKickNotificationChannel()}`
}

/**
 * Optional extra chat / channel IDs for live-start alerts (admins, announcement channels).
 * Env: KICK_NOTIFICATION_CHAT_ID (comma-separated). Empty is OK — users still get DMs.
 */
export function getKickNotificationChatIds() {
  return parseTelegramIdList(process.env.KICK_NOTIFICATION_CHAT_ID)
}

/** Mini App tasks URL — same WEBAPP_URL as /start web_app button, path /tasks. */
export function getKickLiveNotifyTasksWebAppUrl() {
  const base = String(process.env.WEBAPP_URL || '')
    .trim()
    .replace(/\/+$/, '')
  if (!base) {
    return null
  }
  return `${base}/tasks`
}

export function kickLiveNotifyEventKey(streamKey) {
  return `kick-live-notify:${String(streamKey || '').trim()}`
}

export function resolveKickLiveStreamKey({
  livestreamId = null,
  startedAt = null,
  broadcasterUserId = null,
} = {}) {
  if (livestreamId != null && String(livestreamId).trim()) {
    return String(livestreamId).trim()
  }
  if (startedAt != null && String(startedAt).trim()) {
    return `started:${String(startedAt).trim()}`
  }
  const broadcaster = String(broadcasterUserId || '').trim()
  if (broadcaster) {
    return `broadcaster:${broadcaster}:unknown`
  }
  return null
}

/**
 * Pure transition policy (unit-testable).
 * @returns {{ action: 'bootstrap'|'notify'|'none', reason?: string }}
 */
export function evaluateKickLiveNotifyTransition({
  bootstrapped,
  previousIsLive,
  nextIsLive,
  streamKey,
  alreadyNotified,
} = {}) {
  if (!bootstrapped) {
    return { action: 'bootstrap', reason: 'first_observation' }
  }
  if (!nextIsLive) {
    return { action: 'none', reason: 'offline' }
  }
  if (previousIsLive) {
    return { action: 'none', reason: 'still_live' }
  }
  if (!streamKey) {
    return { action: 'none', reason: 'missing_stream_key' }
  }
  if (alreadyNotified) {
    return { action: 'none', reason: 'already_notified' }
  }
  return { action: 'notify', reason: 'offline_to_live' }
}

/**
 * Message body: bare Kick URL on its own line so Telegram can unfurl a link preview.
 */
export function buildKickLiveStartedMessageHtml(channelUrl = getKickNotificationChannelUrl()) {
  const href = String(channelUrl || getKickRequiredChannelUrl()).trim()
  return [
    '🔴 <b>Стрим начался!</b>',
    '',
    'Самое время заглянуть и выполнить ежедневные задания',
    '🔥 Заходи на стрим и начни свой стрик!',
    '',
    '👉 Смотреть на Kick',
    '',
    href,
  ].join('\n')
}

export function buildKickLiveStartedReplyMarkup({
  channelUrl = getKickNotificationChannelUrl(),
  webappUrl = getKickLiveNotifyTasksWebAppUrl(),
} = {}) {
  const href = String(channelUrl || getKickRequiredChannelUrl()).trim()
  const rows = [[{ text: 'Зайти на стрим ↗', url: href }]]
  const appUrl = String(webappUrl || '').trim()
  if (appUrl) {
    rows.push([{ text: 'Выполнять задания ▣', web_app: { url: appUrl } }])
  }
  return { inline_keyboard: rows }
}

export function buildKickLiveStartedSendExtra({
  channelUrl = getKickNotificationChannelUrl(),
  webappUrl = getKickLiveNotifyTasksWebAppUrl(),
} = {}) {
  const href = String(channelUrl || getKickRequiredChannelUrl()).trim()
  return {
    // Override telegram-notify default disable_web_page_preview: true
    disable_web_page_preview: false,
    link_preview_options: {
      is_disabled: false,
      prefer_large_media: true,
      show_above_text: false,
      url: href,
    },
    reply_markup: buildKickLiveStartedReplyMarkup({ channelUrl: href, webappUrl }),
  }
}

function logKickLive(event, details = {}) {
  console.info(`[KICK] ${event}`, details)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)))
}

export function isKickLiveNotifyBlockedUserError(result) {
  const desc = String(result?.description || '').toLowerCase()
  return (
    result?.errorCode === 403 ||
    result?.status === 403 ||
    desc.includes('bot was blocked by the user') ||
    desc.includes('user is deactivated') ||
    desc.includes('chat not found') ||
    desc.includes('peer_id_invalid') ||
    desc.includes('forbidden')
  )
}

function markUserBotBlocked(telegramId) {
  const tid = Number(telegramId)
  if (!Number.isInteger(tid) || tid <= 0) {
    return
  }
  withStore((store) => {
    const user = store.users?.[String(tid)]
    if (!user) {
      return false
    }
    user.botBlocked = true
    user.botBlockedAt = new Date().toISOString()
    return true
  })
}

export function collectKickLiveNotifyRecipients(store) {
  const users = listBroadcastRecipients(store).map((id) => String(id))
  const extras = getKickNotificationChatIds().map((id) => String(id))
  const seen = new Set()
  const out = []
  for (const id of [...users, ...extras]) {
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    out.push(id)
  }
  return out
}

export function unclaimKickLiveNotify(store, streamKey) {
  const key = kickLiveNotifyEventKey(streamKey)
  if (!key) {
    return
  }
  if (store?.kickWebhookEvents) {
    delete store.kickWebhookEvents[key]
  }
  forgetKickWebhookMemoryKey(key)
}

/**
 * Inside withStore: update caller-owned livestream state first, then call this.
 * Claims dedupe key atomically before Telegram send.
 */
export function planKickLiveStartedNotifyOnStore(
  store,
  {
    previousIsLive,
    isLive,
    streamKey,
  },
) {
  const bootstrapped = liveStatusObservedThisProcess
  if (!liveStatusObservedThisProcess) {
    liveStatusObservedThisProcess = true
  }

  const alreadyNotified = Boolean(streamKey && hasKickWebhookEvent(store, kickLiveNotifyEventKey(streamKey)))
  const decision = evaluateKickLiveNotifyTransition({
    bootstrapped,
    previousIsLive: Boolean(previousIsLive),
    nextIsLive: Boolean(isLive),
    streamKey,
    alreadyNotified,
  })

  if (decision.action === 'bootstrap') {
    logKickLive('Live status bootstrap (no notify)', {
      isLive: Boolean(isLive),
      streamKey: streamKey || null,
    })
    return { shouldSend: false, reason: decision.reason, streamKey, claimed: false }
  }

  if (decision.action !== 'notify') {
    if (decision.reason === 'already_notified') {
      logKickLive('duplicate event ignored', { streamKey })
    }
    if (decision.reason === 'offline') {
      logKickLive('stream ended', { streamKey: streamKey || null })
    }
    return { shouldSend: false, reason: decision.reason, streamKey, claimed: false }
  }

  const recipients = collectKickLiveNotifyRecipients(store)
  if (!recipients.length) {
    logKickLive('notification broadcast skipped: no recipients', {
      streamKey: streamKey || null,
    })
    return { shouldSend: false, reason: 'no_recipients', streamKey, claimed: false }
  }

  const claim = markKickWebhookEventProcessed(store, kickLiveNotifyEventKey(streamKey), {
    type: 'kick_live_notify',
    streamKey,
  })
  if (claim.duplicate) {
    logKickLive('duplicate event ignored', { streamKey })
    return { shouldSend: false, reason: 'already_notified', streamKey, claimed: false }
  }

  logKickLive('new stream detected', { streamKey, recipients: recipients.length })
  return {
    shouldSend: true,
    reason: 'offline_to_live',
    streamKey,
    claimed: true,
    recipientCount: recipients.length,
  }
}

async function sendOneKickLiveMessage(chatId, text, extra, fetchImpl, { maxRetries = 3 } = {}) {
  let attempt = 0
  while (attempt <= maxRetries) {
    attempt += 1
    const result = await sendTelegramMessage(chatId, text, extra, { fetchImpl })
    if (result.ok) {
      return { ok: true, result }
    }
    if (isKickLiveNotifyBlockedUserError(result)) {
      return { ok: false, blocked: true, result }
    }
    if (result.status === 429 || result.retryAfter) {
      const waitSec = Math.max(1, Number(result.retryAfter) || 1)
      logKickLive('notification rate limited', { chatId, retryAfter: waitSec, attempt })
      await sleep(waitSec * 1000)
      continue
    }
    return { ok: false, blocked: false, result }
  }
  return { ok: false, blocked: false, result: { error: 'rate_limit_exhausted' } }
}

export async function sendKickLiveStartedTelegram({
  streamKey,
  channelUrl = getKickNotificationChannelUrl(),
  chatIds = null,
  fetchImpl,
  ratePerSec = BROADCAST_RATE_LIMIT_PER_SEC,
} = {}) {
  const href = String(channelUrl || getKickNotificationChannelUrl()).trim()
  const ids =
    Array.isArray(chatIds) && chatIds.length
      ? chatIds.map(String)
      : withStoreRead((store) => collectKickLiveNotifyRecipients(store))

  if (!ids.length) {
    logKickLive('notification broadcast skipped: no recipients', {
      streamKey: streamKey || null,
    })
    return { ok: false, error: 'no_recipients', sent: 0, blocked: 0, failed: 0 }
  }

  const text = buildKickLiveStartedMessageHtml(href)
  const extra = buildKickLiveStartedSendExtra({
    channelUrl: href,
    webappUrl: getKickLiveNotifyTasksWebAppUrl(),
  })
  const delayMs = Math.max(40, Math.floor(1000 / Math.max(1, Number(ratePerSec) || 25)))

  logKickLive('notification broadcast started', {
    streamKey: streamKey || null,
    recipients: ids.length,
    channel: getKickNotificationChannel(),
    is_live: true,
  })

  let sent = 0
  let blocked = 0
  let failed = 0
  const errors = []

  for (const chatId of ids) {
    const outcome = await sendOneKickLiveMessage(chatId, text, extra, fetchImpl)
    if (outcome.ok) {
      sent += 1
      logKickLive('notification sent to user', { chatId, streamKey: streamKey || null })
    } else if (outcome.blocked) {
      blocked += 1
      markUserBotBlocked(chatId)
      logKickLive('notification failed for user', {
        chatId,
        error: 'blocked',
        description: outcome.result?.description || null,
      })
    } else {
      failed += 1
      errors.push({
        chatId,
        error: outcome.result?.error || 'send_failed',
        description: outcome.result?.description || null,
      })
      logKickLive('notification failed for user', {
        chatId,
        error: outcome.result?.error || 'send_failed',
        description: outcome.result?.description || null,
      })
    }
    await sleep(delayMs)
  }

  logKickLive('broadcast finished', {
    streamKey: streamKey || null,
    sent,
    blocked,
    failed,
    total: ids.length,
  })

  if (sent === 0) {
    return { ok: false, error: 'telegram_send_failed', sent: 0, blocked, failed, errors }
  }

  return { ok: true, sent, blocked, failed, errors }
}
