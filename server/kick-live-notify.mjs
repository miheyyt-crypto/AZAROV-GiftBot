/**
 * Telegram notify when the required Kick channel goes OFFLINE → LIVE.
 * Uses existing livestream.status.updated webhook path — no second Kick client.
 */

import {
  getKickRequiredChannel,
  getKickRequiredChannelUrl,
} from './constants.mjs'
import {
  hasKickWebhookEvent,
  markKickWebhookEventProcessed,
} from './kick-streak.mjs'
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
 * Chat / channel IDs for live-start broadcasts.
 * Env: KICK_NOTIFICATION_CHAT_ID (comma-separated). Empty → no send.
 */
export function getKickNotificationChatIds() {
  return parseTelegramIdList(process.env.KICK_NOTIFICATION_CHAT_ID)
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

export function buildKickLiveStartedMessageHtml(channelUrl = getKickNotificationChannelUrl()) {
  const href = String(channelUrl || getKickRequiredChannelUrl())
  return [
    '🔴 <b>Стрим начался!</b>',
    '',
    'Самое время заглянуть и выполнить ежедневные задания',
    '🔥 Заходи на стрим и начни свой стрик!',
    '',
    `👉 <a href="${href}">Смотреть на Kick</a>`,
  ].join('\n')
}

function logKickLive(event, details = {}) {
  console.info(`[KICK] ${event}`, details)
}

function logTelegramLive(event, details = {}) {
  console.info(`[TELEGRAM] ${event}`, details)
}

export function unclaimKickLiveNotify(store, streamKey) {
  const key = kickLiveNotifyEventKey(streamKey)
  if (!key || !store?.kickWebhookEvents) {
    return
  }
  delete store.kickWebhookEvents[key]
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
      logKickLive(`Notification already sent for stream ${streamKey}`)
    }
    return { shouldSend: false, reason: decision.reason, streamKey, claimed: false }
  }

  if (!getKickNotificationChatIds().length) {
    logTelegramLive('Send skipped: KICK_NOTIFICATION_CHAT_ID empty', {
      streamKey: streamKey || null,
    })
    return { shouldSend: false, reason: 'chat_id_missing', streamKey, claimed: false }
  }

  const claim = markKickWebhookEventProcessed(store, kickLiveNotifyEventKey(streamKey), {
    type: 'kick_live_notify',
    streamKey,
  })
  if (claim.duplicate) {
    logKickLive(`Notification already sent for stream ${streamKey}`)
    return { shouldSend: false, reason: 'already_notified', streamKey, claimed: false }
  }

  logKickLive('Stream started', { streamKey })
  return { shouldSend: true, reason: 'offline_to_live', streamKey, claimed: true }
}

export async function sendKickLiveStartedTelegram({
  streamKey,
  channelUrl = getKickNotificationChannelUrl(),
  chatIds = getKickNotificationChatIds(),
  fetchImpl,
} = {}) {
  const ids = Array.isArray(chatIds) ? chatIds : getKickNotificationChatIds()
  if (!ids.length) {
    logTelegramLive('Send skipped: KICK_NOTIFICATION_CHAT_ID empty', {
      streamKey: streamKey || null,
    })
    return { ok: false, error: 'chat_id_missing', sent: 0 }
  }

  const text = buildKickLiveStartedMessageHtml(channelUrl)
  logTelegramLive('Sending live notification', {
    streamKey: streamKey || null,
    chats: ids.length,
  })

  let sent = 0
  const errors = []
  for (const chatId of ids) {
    const result = await sendTelegramMessage(chatId, text, {}, { fetchImpl })
    if (result.ok) {
      sent += 1
    } else {
      errors.push({
        chatId,
        error: result.error || 'send_failed',
        description: result.description || null,
      })
      logTelegramLive('Send error', {
        chatId,
        error: result.error || 'send_failed',
        description: result.description || null,
      })
    }
  }

  if (sent === 0) {
    return { ok: false, error: 'telegram_send_failed', sent: 0, errors }
  }

  logTelegramLive('Notification sent', { streamKey: streamKey || null, sent })
  return { ok: true, sent, errors }
}
