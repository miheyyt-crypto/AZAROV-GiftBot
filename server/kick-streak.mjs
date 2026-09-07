import {
  getKickRequiredChannel,
  KICK_STREAK_TIMEZONE,
  STREAK_FREEZE_PRODUCT_ID,
} from './constants.mjs'
import { fetchKickChannelLiveStatus, resolveKickChannelBySlug } from './kick-api.mjs'
import { getKickConnectionForUser } from './kick-oauth.mjs'
import { withStore, withStoreRead } from './store.mjs'

const WEBHOOK_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Fresh livestream.status.updated / API snapshot window (ms). */
export const LIVE_STATE_STALE_MS = 2 * 60 * 1000

function logKickStreak(event, details = {}) {
  console.info(`[kick-streak] ${event}`, details)
}

/**
 * Calendar date YYYY-MM-DD in the project streak timezone (UTC).
 */
export function toStreakCalendarDate(isoOrDate) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toISOString().slice(0, 10)
}

export function streakDayDiff(earlierDate, laterDate) {
  const a = String(earlierDate || '')
  const b = String(laterDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) {
    return null
  }
  const ms = Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)
  return Math.round(ms / 86_400_000)
}

function pruneWebhookEvents(store, nowMs = Date.now()) {
  store.kickWebhookEvents = store.kickWebhookEvents || {}
  const cutoff = nowMs - WEBHOOK_EVENT_TTL_MS
  for (const [id, row] of Object.entries(store.kickWebhookEvents)) {
    const processed = Date.parse(row?.processedAt || 0)
    if (!Number.isFinite(processed) || processed < cutoff) {
      delete store.kickWebhookEvents[id]
    }
  }
}

export function hasKickWebhookEvent(store, eventKey) {
  if (!eventKey) {
    return false
  }
  store.kickWebhookEvents = store.kickWebhookEvents || {}
  pruneWebhookEvents(store)
  return Boolean(store.kickWebhookEvents[eventKey])
}

export function markKickWebhookEventProcessed(store, eventKey, meta = {}) {
  if (!eventKey) {
    return { duplicate: false }
  }
  store.kickWebhookEvents = store.kickWebhookEvents || {}
  pruneWebhookEvents(store)
  if (store.kickWebhookEvents[eventKey]) {
    return { duplicate: true, existing: store.kickWebhookEvents[eventKey] }
  }
  store.kickWebhookEvents[eventKey] = {
    processedAt: new Date().toISOString(),
    ...meta,
  }
  return { duplicate: false }
}

export function updateKickLivestreamStateOnStore(
  store,
  { broadcasterUserId, channelSlug, isLive, startedAt, endedAt, source = 'webhook' },
) {
  const now = new Date().toISOString()
  store.kickLivestreamState = {
    broadcasterUserId: String(broadcasterUserId || ''),
    channelSlug: String(channelSlug || getKickRequiredChannel()).toLowerCase(),
    isLive: Boolean(isLive),
    startedAt: startedAt || null,
    endedAt: endedAt || null,
    source,
    updatedAt: now,
  }
  return store.kickLivestreamState
}

export function liveStateLooksFresh(state, nowMs = Date.now()) {
  if (!state?.updatedAt) {
    return false
  }
  const updated = Date.parse(state.updatedAt)
  return Number.isFinite(updated) && nowMs - updated <= LIVE_STATE_STALE_MS
}

function messageFitsLiveWindow(messageAt, startedAtIso) {
  const started = startedAtIso ? Date.parse(startedAtIso) : null
  if (Number.isFinite(started) && messageAt < started) {
    return false
  }
  return true
}

/**
 * Fail-closed live gate.
 * - Fresh store state (livestream.status.updated / recent API) may decide yes/no.
 * - Stale isLive=true is NEVER enough — requires liveApi boolean confirmation.
 * - No liveApi when unconfirmed → duringLive=false, reason=unconfirmed (do not mark event).
 *
 * @returns {{ duringLive: boolean, reason: 'live'|'not_live'|'unconfirmed'|'invalid_time' }}
 */
export function isMessageDuringLive(store, messageAtIso, liveApi = null, { nowMs = Date.now() } = {}) {
  const messageAt = Date.parse(messageAtIso)
  if (!Number.isFinite(messageAt)) {
    return { duringLive: false, reason: 'invalid_time' }
  }

  const state = store.kickLivestreamState
  if (state && liveStateLooksFresh(state, nowMs)) {
    if (!state.isLive) {
      return { duringLive: false, reason: 'not_live' }
    }
    if (!messageFitsLiveWindow(messageAt, state.startedAt)) {
      return { duringLive: false, reason: 'not_live' }
    }
    return { duringLive: true, reason: 'live' }
  }

  // Stale / missing store state: only an explicit livestream API result counts.
  if (liveApi && typeof liveApi.isLive === 'boolean') {
    if (!liveApi.isLive) {
      return { duringLive: false, reason: 'not_live' }
    }
    if (!messageFitsLiveWindow(messageAt, liveApi.startedAt)) {
      return { duringLive: false, reason: 'not_live' }
    }
    return { duringLive: true, reason: 'live' }
  }

  return { duringLive: false, reason: 'unconfirmed' }
}

/**
 * Apply calendar-day chat activity to a streak record (idempotent per day).
 * Freeze product is NOT auto-consumed — shop only creates orders today.
 */
export function applyChatActivityToStreak(record, activityDate, { nowIso } = {}) {
  const date = String(activityDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { changed: false, reason: 'invalid_date', record }
  }

  const now = nowIso || new Date().toISOString()
  const next = {
    ...record,
    activeDays: Array.isArray(record.activeDays) ? [...record.activeDays] : [],
  }

  if (next.lastActiveDate === date) {
    return { changed: false, reason: 'same_day', record: next }
  }

  const previous = next.lastActiveDate
  let currentStreak = Number(next.currentStreak) || 0

  if (!previous) {
    currentStreak = 1
  } else {
    const diff = streakDayDiff(previous, date)
    if (diff == null) {
      currentStreak = 1
    } else if (diff === 1) {
      currentStreak = currentStreak + 1
    } else if (diff > 1) {
      currentStreak = 1
    } else {
      return { changed: false, reason: 'out_of_order', record: next }
    }
  }

  next.currentStreak = currentStreak
  next.lastActiveDate = date
  next.longestStreak = Math.max(Number(next.longestStreak) || 0, currentStreak)
  if (!next.activeDays.includes(date)) {
    next.activeDays.push(date)
    if (next.activeDays.length > 90) {
      next.activeDays = next.activeDays.slice(-90)
    }
  }
  next.updatedAt = now
  if (!next.createdAt) {
    next.createdAt = now
  }

  return {
    changed: true,
    reason: previous ? (streakDayDiff(previous, date) === 1 ? 'continued' : 'reset') : 'started',
    record: next,
  }
}

/**
 * If last activity is older than yesterday, streak is broken until next credit.
 */
export function reconcileStreakForToday(record, todayDate) {
  if (!record) {
    return null
  }
  const last = record.lastActiveDate
  if (!last) {
    return {
      ...record,
      currentStreak: 0,
    }
  }
  const diff = streakDayDiff(last, todayDate)
  if (diff == null) {
    return record
  }
  if (diff <= 1) {
    return record
  }
  return {
    ...record,
    currentStreak: 0,
    updatedAt: new Date().toISOString(),
  }
}

function emptyStreakRecord({ telegramId, kickUserId }) {
  const now = new Date().toISOString()
  return {
    telegramId: Number(telegramId),
    kickUserId: String(kickUserId),
    currentStreak: 0,
    lastActiveDate: null,
    longestStreak: 0,
    activeDays: [],
    createdAt: now,
    updatedAt: now,
  }
}

function findTelegramIdForKickUser(store, kickUserId) {
  const kickKey = String(kickUserId)
  const account = store.kickAccounts?.[kickKey]
  if (account?.telegramUserId) {
    return Number(account.telegramUserId)
  }
  for (const [tgId, linkedKick] of Object.entries(store.kickByTelegram || {})) {
    if (String(linkedKick) === kickKey) {
      return Number(tgId)
    }
  }
  const user = Object.values(store.users || {}).find(
    (row) => row && String(row.kickUserId || '') === kickKey,
  )
  return user?.telegramId ? Number(user.telegramId) : null
}

/**
 * Resolve canonical broadcaster user id for KICK_REQUIRED_CHANNEL (no slug fallback for matching).
 */
export async function resolveRequiredBroadcasterUserId(options = {}) {
  const slug = getKickRequiredChannel()
  const channel = await resolveKickChannelBySlug(slug, options)
  const broadcasterUserId = String(channel?.broadcasterUserId || '').trim()
  if (!broadcasterUserId) {
    const error = new Error('channel_unresolved')
    error.code = 'channel_unresolved'
    throw error
  }
  return { slug: channel.slug || slug, broadcasterUserId }
}

function eventKeysForChat(messageId, payloadMessageId) {
  const headerKey = String(messageId || '').trim()
  const chatKey = payloadMessageId ? `chat:${payloadMessageId}` : ''
  const primary = headerKey || chatKey
  const secondary =
    payloadMessageId && primary !== `chat:${payloadMessageId}` ? `chat:${payloadMessageId}` : ''
  return { primary, secondary }
}

function markChatEventProcessed(store, { primary, secondary }, meta) {
  if (primary) {
    markKickWebhookEventProcessed(store, primary, meta)
  }
  if (secondary) {
    markKickWebhookEventProcessed(store, secondary, meta)
  }
}

export async function processLivestreamStatusUpdated(payload, options = {}) {
  const broadcasterUserId = String(payload?.broadcaster?.user_id ?? '').trim()
  const channelSlug = String(payload?.broadcaster?.channel_slug || payload?.broadcaster?.username || '')
    .trim()
    .toLowerCase()

  if (!broadcasterUserId) {
    return { ok: true, ignored: true, reason: 'missing_broadcaster' }
  }

  let required
  try {
    required = await resolveRequiredBroadcasterUserId(options)
  } catch {
    return { ok: true, ignored: true, reason: 'channel_unresolved' }
  }

  if (String(required.broadcasterUserId) !== broadcasterUserId) {
    return { ok: true, ignored: true, reason: 'wrong_channel' }
  }

  const isLive = Boolean(payload?.is_live)
  withStore((store) => {
    updateKickLivestreamStateOnStore(store, {
      broadcasterUserId,
      channelSlug: channelSlug || required.slug,
      isLive,
      startedAt: payload?.started_at || null,
      endedAt: payload?.ended_at || null,
      source: 'webhook',
    })
  })

  logKickStreak('livestream_status', {
    broadcasterUserId,
    isLive,
    channelSlug: channelSlug || required.slug,
  })

  return { ok: true, isLive }
}

/**
 * Process chat.message.sent for streak credit.
 * Channel gate: canonical broadcaster ID only.
 * Live gate: fail-closed.
 * Idempotency: mark only after definitive outcome (not on live API errors).
 */
export async function processChatMessageSent(payload, { messageId, options = {} } = {}) {
  const payloadMessageId = String(payload?.message_id || '').trim()
  const keys = eventKeysForChat(messageId, payloadMessageId)

  const senderKickUserId = String(payload?.sender?.user_id ?? '').trim()
  const broadcasterUserId = String(payload?.broadcaster?.user_id ?? '').trim()
  const channelSlug = String(payload?.broadcaster?.channel_slug || payload?.broadcaster?.username || '')
    .trim()
    .toLowerCase()
  const createdAt = String(payload?.created_at || '').trim() || new Date().toISOString()

  if (!senderKickUserId || !broadcasterUserId) {
    return { ok: true, ignored: true, reason: 'missing_ids' }
  }

  let required
  try {
    required = await resolveRequiredBroadcasterUserId(options)
  } catch {
    logKickStreak('chat_ignored_channel_unresolved', { broadcasterUserId })
    return { ok: true, ignored: true, reason: 'channel_unresolved' }
  }

  if (String(required.broadcasterUserId) !== broadcasterUserId) {
    return withStore((store) => {
      if (keys.primary && hasKickWebhookEvent(store, keys.primary)) {
        return { ok: true, ignored: true, reason: 'duplicate_event' }
      }
      if (keys.secondary && hasKickWebhookEvent(store, keys.secondary)) {
        return { ok: true, ignored: true, reason: 'duplicate_message' }
      }
      markChatEventProcessed(store, keys, {
        type: 'chat.message.sent',
        outcome: 'wrong_channel',
        senderKickUserId,
      })
      return { ok: true, ignored: true, reason: 'wrong_channel' }
    })
  }

  const needsLiveLookup = withStoreRead((store) => {
    const state = store.kickLivestreamState
    return !(
      state &&
      liveStateLooksFresh(state) &&
      String(state.broadcasterUserId) === broadcasterUserId
    )
  })

  let liveApi = null
  let liveApiError = false

  if (needsLiveLookup) {
    try {
      liveApi = await fetchKickChannelLiveStatus(broadcasterUserId, options)
      withStore((store) => {
        updateKickLivestreamStateOnStore(store, {
          broadcasterUserId,
          channelSlug: channelSlug || required.slug,
          isLive: Boolean(liveApi?.isLive),
          startedAt: liveApi?.startedAt || null,
          endedAt: liveApi?.isLive ? null : liveApi?.endedAt || null,
          source: 'api',
        })
      })
    } catch {
      liveApi = null
      liveApiError = true
    }
  }

  return withStore((store) => {
    if (keys.primary && hasKickWebhookEvent(store, keys.primary)) {
      return { ok: true, ignored: true, reason: 'duplicate_event' }
    }
    if (keys.secondary && hasKickWebhookEvent(store, keys.secondary)) {
      return { ok: true, ignored: true, reason: 'duplicate_message' }
    }

    const live = isMessageDuringLive(store, createdAt, liveApiError ? null : liveApi)

    if (live.reason === 'unconfirmed' || liveApiError) {
      logKickStreak('chat_live_unconfirmed', {
        senderKickUserId,
        broadcasterUserId,
        liveApiError,
      })
      // Do NOT mark — Kick may retry; temporary API failure must not eat the event.
      return { ok: true, ignored: true, reason: 'live_api_unavailable' }
    }

    if (!live.duringLive) {
      markChatEventProcessed(store, keys, {
        type: 'chat.message.sent',
        outcome: 'not_live',
        kickMessageId: payloadMessageId || null,
        senderKickUserId,
      })
      logKickStreak('chat_ignored_offline', { senderKickUserId, broadcasterUserId })
      return { ok: true, ignored: true, reason: 'not_live' }
    }

    const telegramId = findTelegramIdForKickUser(store, senderKickUserId)
    if (!telegramId) {
      markChatEventProcessed(store, keys, {
        type: 'chat.message.sent',
        outcome: 'unlinked_kick',
        kickMessageId: payloadMessageId || null,
        senderKickUserId,
      })
      logKickStreak('chat_ignored_unlinked', { senderKickUserId })
      return { ok: true, ignored: true, reason: 'unlinked_kick' }
    }

    store.kickStreamStreaks = store.kickStreamStreaks || {}
    const streakKey = String(telegramId)
    const existing =
      store.kickStreamStreaks[streakKey] ||
      emptyStreakRecord({ telegramId, kickUserId: senderKickUserId })

    existing.kickUserId = String(senderKickUserId)
    existing.telegramId = Number(telegramId)

    const activityDate = toStreakCalendarDate(createdAt)
    const applied = applyChatActivityToStreak(existing, activityDate)
    store.kickStreamStreaks[streakKey] = applied.record

    markChatEventProcessed(store, keys, {
      type: 'chat.message.sent',
      outcome: applied.changed ? 'credited' : applied.reason,
      kickMessageId: payloadMessageId || null,
      senderKickUserId,
      telegramId,
    })

    if (applied.changed) {
      logKickStreak('day_credited', {
        telegramId,
        kickUserId: senderKickUserId,
        date: activityDate,
        currentStreak: applied.record.currentStreak,
        reason: applied.reason,
      })
    }

    return {
      ok: true,
      credited: Boolean(applied.changed),
      reason: applied.reason,
      telegramId,
      currentStreak: applied.record.currentStreak,
      lastActiveDate: applied.record.lastActiveDate,
    }
  })
}

export function getKickStreakForUser(telegramUserId) {
  const today = toStreakCalendarDate(new Date())
  return withStore((store) => {
    const connection = getKickConnectionForUser(store, telegramUserId)
    const connected = Boolean(connection?.connected && connection.kickUserId)
    store.kickStreamStreaks = store.kickStreamStreaks || {}
    const key = String(telegramUserId)
    let record = store.kickStreamStreaks[key] || null

    if (record) {
      const reconciled = reconcileStreakForToday(record, today)
      if (reconciled && reconciled.currentStreak !== record.currentStreak) {
        store.kickStreamStreaks[key] = reconciled
        record = reconciled
      }
    }

    const lastActiveDate = record?.lastActiveDate || null
    const creditedToday = Boolean(lastActiveDate && lastActiveDate === today)
    const currentStreak = Number(record?.currentStreak) || 0

    const freezeOrders = Object.values(store.orders || {}).filter(
      (order) =>
        Number(order?.userId) === Number(telegramUserId) &&
        String(order?.productId) === STREAK_FREEZE_PRODUCT_ID &&
        ['pending', 'processing', 'completed'].includes(String(order?.status || '').toLowerCase()),
    )

    return {
      success: true,
      timezone: KICK_STREAK_TIMEZONE,
      channel: getKickRequiredChannel(),
      kickConnected: connected,
      kickUsername: connection?.username || null,
      kickUserId: connection?.kickUserId || null,
      currentStreak: connected ? currentStreak : 0,
      lastActiveDate: connected ? lastActiveDate : null,
      creditedToday: connected ? creditedToday : false,
      todayDate: today,
      freezeAvailable: freezeOrders.length,
      freezeAutoConsume: false,
      message: !connected
        ? 'Привяжи Kick, чтобы участвовать в стрике'
        : creditedToday
          ? null
          : currentStreak > 0
            ? 'Сегодня ещё не засчитано'
            : 'Напиши в чат во время стрима, чтобы начать стрик',
    }
  })
}

/** Test helpers */
export function _findTelegramIdForKickUser(store, kickUserId) {
  return findTelegramIdForKickUser(store, kickUserId)
}
