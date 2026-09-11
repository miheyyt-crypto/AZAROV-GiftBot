import { getKickRequiredChannel, KICK_STREAK_TIMEZONE } from './constants.mjs'
import {
  consumeStreakFreezeInventoryOnStore,
  countAvailableStreakFreezes,
  listAvailableStreakFreezeItems,
} from './inventory.mjs'
import { fetchKickChannelLiveStatus, resolveKickChannelBySlug } from './kick-api.mjs'
import { getKickConnectionForUser } from './kick-oauth.mjs'
import {
  applyWatchActivityOnStore,
  closeWatchSessionsOnStore,
  recordChatMessageOnStore,
} from './kick-stats.mjs'
import { withStore, withStoreRead } from './store.mjs'
import { grantPendingLevelRewardsOnStore } from './level-rewards.mjs'
import {
  getKickNotificationChannelUrl,
  planKickLiveStartedNotifyOnStore,
  resolveKickLiveStreamKey,
  sendKickLiveStartedTelegram,
  unclaimKickLiveNotify,
} from './kick-live-notify.mjs'

const WEBHOOK_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Fresh livestream.status.updated / API snapshot window (ms). */
export const LIVE_STATE_STALE_MS = 2 * 60 * 1000

function maybeGrantLevelRewardsAfterXp(store, telegramId) {
  const user = store.users?.[String(telegramId)]
  if (!user) {
    return null
  }
  return grantPendingLevelRewardsOnStore(store, user)
}

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
  {
    broadcasterUserId,
    channelSlug,
    isLive,
    startedAt,
    endedAt,
    livestreamId = null,
    source = 'webhook',
  },
) {
  const now = new Date().toISOString()
  store.kickLivestreamState = {
    broadcasterUserId: String(broadcasterUserId || ''),
    channelSlug: String(channelSlug || getKickRequiredChannel()).toLowerCase(),
    isLive: Boolean(isLive),
    startedAt: startedAt || null,
    endedAt: endedAt || null,
    livestreamId: livestreamId != null && String(livestreamId).trim() ? String(livestreamId).trim() : null,
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

export { countAvailableStreakFreezes }
export const listAvailableStreakFreezeOrders = listAvailableStreakFreezeItems

export function streakFreezeEventId(telegramUserId, activityDate) {
  return `streak:freeze:${telegramUserId}:${activityDate}`
}

/**
 * Atomically consume one available freeze inventory item for a calendar gap day.
 * Idempotent per (telegramId, activityDate) via ledger event id.
 * Shop order stays completed — inventory is the source of truth.
 */
export function consumeStreakFreezeOnStore(store, telegramUserId, activityDate) {
  const eventId = streakFreezeEventId(telegramUserId, activityDate)
  return consumeStreakFreezeInventoryOnStore(store, telegramUserId, activityDate, eventId)
}

/**
 * Apply calendar-day chat activity to a streak record (idempotent per day).
 * When useFreeze=true and exactly one calendar day was skipped, keep streak
 * and only advance lastActiveDate (caller must consume a freeze first).
 */
export function applyChatActivityToStreak(record, activityDate, { nowIso, useFreeze = false } = {}) {
  const date = String(activityDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { changed: false, reason: 'invalid_date', record, freezeUsed: false }
  }

  const now = nowIso || new Date().toISOString()
  const next = {
    ...record,
    activeDays: Array.isArray(record.activeDays) ? [...record.activeDays] : [],
  }

  if (next.lastActiveDate === date) {
    return { changed: false, reason: 'same_day', record: next, freezeUsed: false }
  }

  const previous = next.lastActiveDate
  let currentStreak = Number(next.currentStreak) || 0
  let reason = 'started'
  let freezeUsed = false

  if (!previous) {
    currentStreak = 1
    reason = 'started'
  } else {
    const diff = streakDayDiff(previous, date)
    if (diff == null) {
      currentStreak = 1
      reason = 'reset'
    } else if (diff === 1) {
      currentStreak = currentStreak + 1
      reason = 'continued'
    } else if (diff === 2 && useFreeze) {
      // Keep streak; skipped day is covered by freeze (no +1 for the gap).
      freezeUsed = true
      reason = 'freeze_saved'
    } else if (diff > 1) {
      currentStreak = 1
      reason = 'reset'
    } else {
      return { changed: false, reason: 'out_of_order', record: next, freezeUsed: false }
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
    reason,
    record: next,
    freezeUsed,
  }
}

/**
 * If last activity is older than yesterday, streak is broken until next credit.
 * Exactly one missed day can still be saved by an available freeze on next chat.
 */
export function reconcileStreakForToday(record, todayDate, { freezeAvailable = 0 } = {}) {
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
  if (diff === 2 && Number(freezeAvailable) > 0) {
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
  const livestreamId =
    payload?.livestream?.id != null
      ? String(payload.livestream.id)
      : payload?.livestream_id != null
        ? String(payload.livestream_id)
        : null
  const startedAt = payload?.started_at || null
  const streamKey = resolveKickLiveStreamKey({
    livestreamId,
    startedAt,
    broadcasterUserId,
  })

  const plan = withStore((store) => {
    const previousIsLive = Boolean(store.kickLivestreamState?.isLive)
    updateKickLivestreamStateOnStore(store, {
      broadcasterUserId,
      channelSlug: channelSlug || required.slug,
      isLive,
      startedAt,
      endedAt: payload?.ended_at || null,
      livestreamId,
      source: 'webhook',
    })

    if (!isLive) {
      closeWatchSessionsOnStore(store, {
        streamId: streamKey,
        endedAtIso: payload?.ended_at || new Date().toISOString(),
      })
    }

    return planKickLiveStartedNotifyOnStore(store, {
      previousIsLive,
      isLive,
      streamKey,
    })
  })

  logKickStreak('livestream_status', {
    broadcasterUserId,
    isLive,
    channelSlug: channelSlug || required.slug,
    streamKey: streamKey || null,
    notify: plan?.shouldSend || false,
    notifyReason: plan?.reason || null,
  })

  let notify = {
    attempted: false,
    sent: false,
    reason: plan?.reason || null,
  }

  if (plan?.shouldSend) {
    notify.attempted = true
    const sendResult = await sendKickLiveStartedTelegram({
      streamKey: plan.streamKey,
      channelUrl: getKickNotificationChannelUrl(),
      fetchImpl: options.fetchImpl || options.telegramFetchImpl,
    })
    if (sendResult.ok) {
      notify.sent = true
    } else {
      // Do not keep a success claim when Telegram failed — allow a safe retry.
      withStore((store) => {
        unclaimKickLiveNotify(store, plan.streamKey)
        return true
      })
      notify.reason = sendResult.error || 'telegram_send_failed'
      logKickStreak('livestream_notify_failed', {
        streamKey: plan.streamKey,
        error: notify.reason,
      })
    }
  }

  return { ok: true, isLive, streamKey, notify }
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
      const telegramIdOffline = findTelegramIdForKickUser(store, senderKickUserId)
      if (telegramIdOffline) {
        recordChatMessageOnStore(store, telegramIdOffline)
        maybeGrantLevelRewardsAfterXp(store, telegramIdOffline)
      }
      markChatEventProcessed(store, keys, {
        type: 'chat.message.sent',
        outcome: telegramIdOffline ? 'offline_message' : 'not_live',
        kickMessageId: payloadMessageId || null,
        senderKickUserId,
        telegramId: telegramIdOffline || null,
      })
      logKickStreak('chat_ignored_offline', {
        senderKickUserId,
        broadcasterUserId,
        countedMessage: Boolean(telegramIdOffline),
      })
      return {
        ok: true,
        ignored: true,
        reason: 'not_live',
        telegramId: telegramIdOffline || undefined,
        countedMessage: Boolean(telegramIdOffline),
      }
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

    // Linked + live: message count, watch heartbeat, then streak.
    recordChatMessageOnStore(store, telegramId)
    const streamId =
      store.kickLivestreamState?.startedAt != null
        ? `started:${store.kickLivestreamState.startedAt}`
        : null
    applyWatchActivityOnStore(store, telegramId, {
      atIso: createdAt,
      streamId,
      isLiveConfirmed: true,
    })
    maybeGrantLevelRewardsAfterXp(store, telegramId)

    store.kickStreamStreaks = store.kickStreamStreaks || {}
    const streakKey = String(telegramId)
    const existing =
      store.kickStreamStreaks[streakKey] ||
      emptyStreakRecord({ telegramId, kickUserId: senderKickUserId })

    existing.kickUserId = String(senderKickUserId)
    existing.telegramId = Number(telegramId)

    const activityDate = toStreakCalendarDate(createdAt)
    const previousDate = existing.lastActiveDate || null
    const gap =
      previousDate && activityDate && previousDate !== activityDate
        ? streakDayDiff(previousDate, activityDate)
        : null

    let useFreeze = false
    let freezeConsume = null
    if (gap === 2) {
      freezeConsume = consumeStreakFreezeOnStore(store, telegramId, activityDate)
      useFreeze =
        Boolean(freezeConsume.consumed) ||
        freezeConsume.reason === 'already_consumed_for_date'
      if (freezeConsume.consumed) {
        logKickStreak('freeze_consumed', {
          telegramId,
          date: activityDate,
          orderId: freezeConsume.orderId,
          remaining: countAvailableStreakFreezes(store, telegramId),
        })
      }
    }

    const applied = applyChatActivityToStreak(existing, activityDate, { useFreeze })
    store.kickStreamStreaks[streakKey] = applied.record

    markChatEventProcessed(store, keys, {
      type: 'chat.message.sent',
      outcome: applied.changed ? applied.reason : applied.reason,
      kickMessageId: payloadMessageId || null,
      senderKickUserId,
      telegramId,
      freezeUsed: Boolean(applied.freezeUsed),
      freezeOrderId: freezeConsume?.orderId || null,
    })

    if (applied.changed) {
      logKickStreak('day_credited', {
        telegramId,
        kickUserId: senderKickUserId,
        date: activityDate,
        currentStreak: applied.record.currentStreak,
        reason: applied.reason,
        freezeUsed: Boolean(applied.freezeUsed),
      })
    }

    return {
      ok: true,
      credited: Boolean(applied.changed),
      reason: applied.reason,
      telegramId,
      currentStreak: applied.record.currentStreak,
      lastActiveDate: applied.record.lastActiveDate,
      freezeUsed: Boolean(applied.freezeUsed),
      freezeAvailable: countAvailableStreakFreezes(store, telegramId),
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
    const freezeAvailable = connected ? countAvailableStreakFreezes(store, telegramUserId) : 0

    if (record) {
      const reconciled = reconcileStreakForToday(record, today, { freezeAvailable })
      if (reconciled && reconciled.currentStreak !== record.currentStreak) {
        store.kickStreamStreaks[key] = reconciled
        record = reconciled
      }
    }

    const lastActiveDate = record?.lastActiveDate || null
    const creditedToday = Boolean(lastActiveDate && lastActiveDate === today)
    const currentStreak = connected ? Number(record?.currentStreak) || 0 : 0
    const progressCurrent = currentStreak
    const progressRequired = currentStreak + 1
    const nextReward = getNextStreakRewardCoins(currentStreak)

    return {
      success: true,
      timezone: KICK_STREAK_TIMEZONE,
      channel: getKickRequiredChannel(),
      kickConnected: connected,
      kickUsername: connection?.username || null,
      kickUserId: connection?.kickUserId || null,
      currentStreak,
      lastActiveDate: connected ? lastActiveDate : null,
      creditedToday: connected ? creditedToday : false,
      todayDate: today,
      freezeAvailable: connected ? freezeAvailable : 0,
      freezeAutoConsume: true,
      progressCurrent,
      progressRequired,
      nextReward,
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

/**
 * Display schedule for the next streak-day bonus (coins).
 * Presentation metadata only — does not grant coins or change credit rules.
 */
export function getNextStreakRewardCoins(currentStreak) {
  const nextDay = Math.max(1, Math.floor(Number(currentStreak) || 0) + 1)
  return nextDay * 100
}

/**
 * Home LIVE banner payload from existing livestream state (+ API refresh when stale).
 * Fail-closed: unconfirmed live → isLive false (hide banner).
 */
export async function getKickLiveBannerState(options = {}) {
  const channelSlug = getKickRequiredChannel()
  let channel = null
  try {
    channel = await resolveKickChannelBySlug(channelSlug, options)
  } catch {
    return {
      isLive: false,
      channelSlug,
      channelAvatarUrl: null,
    }
  }

  const channelAvatarUrl = String(channel?.profilePicture || '').trim() || null
  const broadcasterUserId = String(channel.broadcasterUserId || '')

  const fresh = withStoreRead((store) => {
    const state = store.kickLivestreamState
    if (
      !state ||
      !liveStateLooksFresh(state) ||
      String(state.broadcasterUserId) !== broadcasterUserId
    ) {
      return null
    }
    return {
      isLive: Boolean(state.isLive),
      channelSlug: String(state.channelSlug || channelSlug).toLowerCase(),
      channelAvatarUrl,
    }
  })

  if (fresh) {
    return fresh
  }

  try {
    const liveApi = await fetchKickChannelLiveStatus(broadcasterUserId, options)
    withStore((store) => {
      updateKickLivestreamStateOnStore(store, {
        broadcasterUserId,
        channelSlug,
        isLive: Boolean(liveApi.isLive),
        startedAt: liveApi.startedAt || null,
        endedAt: liveApi.isLive ? null : new Date().toISOString(),
        livestreamId: null,
        source: 'home_poll',
      })
      return true
    })
    return {
      isLive: Boolean(liveApi.isLive),
      channelSlug,
      channelAvatarUrl,
    }
  } catch {
    return {
      isLive: false,
      channelSlug,
      channelAvatarUrl,
    }
  }
}

/** Test helpers */
export function _findTelegramIdForKickUser(store, kickUserId) {
  return findTelegramIdForKickUser(store, kickUserId)
}
