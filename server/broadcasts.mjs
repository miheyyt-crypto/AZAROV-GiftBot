import crypto from 'node:crypto'

import { withStore, withStoreRead } from './store.mjs'
import {
  copyTelegramMessage,
  editTelegramMessageText,
} from './telegram-notify.mjs'

export const BROADCAST_STATUS = {
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
}

/** Safe default under Telegram private-chat flood limits (~30/s). */
export const BROADCAST_RATE_LIMIT_PER_SEC = Math.max(
  1,
  Math.min(30, Number(process.env.BROADCAST_RATE_LIMIT || 25) || 25),
)

const TICK_MS = Math.max(40, Math.floor(1000 / BROADCAST_RATE_LIMIT_PER_SEC))
const PROGRESS_EVERY_N = 25
const PROGRESS_EVERY_MS = 3000
const MAX_RETRIES = 3

let schedulerTimer = null
let tickBusy = false

function utcNow() {
  return new Date().toISOString()
}

function ensureMaps(store) {
  store.broadcasts = store.broadcasts || {}
  store.users = store.users || {}
  store.events = store.events || {}
}

export function generateBroadcastId(store) {
  for (let i = 0; i < 40; i += 1) {
    const id = `BC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    if (!store.broadcasts[id]) {
      return id
    }
  }
  throw new Error('broadcast_id_collision')
}

export function listBroadcastRecipients(store) {
  ensureMaps(store)
  return Object.values(store.users)
    .filter((user) => {
      if (!user || typeof user !== 'object') {
        return false
      }
      const tid = Number(user.telegramId)
      if (!Number.isInteger(tid) || tid <= 0) {
        return false
      }
      if (user.botBlocked === true) {
        return false
      }
      return true
    })
    .map((user) => Number(user.telegramId))
}

export function countBroadcastRecipients() {
  return withStoreRead((store) => listBroadcastRecipients(store).length)
}

export function publicBroadcast(row) {
  if (!row) {
    return null
  }
  return {
    id: row.id,
    adminId: Number(row.adminId) || null,
    status: row.status,
    contentType: row.contentType,
    total: Array.isArray(row.recipientIds) ? row.recipientIds.length : Number(row.total) || 0,
    sent: Number(row.sent) || 0,
    failed: Number(row.failed) || 0,
    blocked: Number(row.blocked) || 0,
    nextIndex: Number(row.nextIndex) || 0,
    createdAt: row.createdAt || null,
    startedAt: row.startedAt || null,
    finishedAt: row.finishedAt || null,
    textPreview: row.textPreview || null,
  }
}

export function createBroadcastDraftOnStore(store, input = {}) {
  ensureMaps(store)
  const adminId = Number(input.adminId)
  if (!Number.isInteger(adminId) || adminId <= 0) {
    return { success: false, code: 'UNAUTHORIZED', message: 'Недостаточно прав.' }
  }

  const sourceChatId = Number(input.sourceChatId)
  const sourceMessageId = Number(input.sourceMessageId)
  if (!Number.isInteger(sourceChatId) || !Number.isInteger(sourceMessageId) || sourceMessageId <= 0) {
    return { success: false, code: 'INVALID_CONTENT', message: 'Некорректное сообщение.' }
  }

  const contentType = input.contentType === 'photo' ? 'photo' : 'text'
  const textPreview = String(input.textPreview || '').slice(0, 500)
  const recipientIds = listBroadcastRecipients(store)
  const id = generateBroadcastId(store)
  const createdAt = utcNow()

  const broadcast = {
    id,
    adminId,
    status: BROADCAST_STATUS.DRAFT,
    contentType,
    sourceChatId,
    sourceMessageId,
    textPreview,
    recipientIds,
    total: recipientIds.length,
    nextIndex: 0,
    sent: 0,
    failed: 0,
    blocked: 0,
    retries: {},
    progressChatId: null,
    progressMessageId: null,
    lastProgressAt: null,
    pauseUntil: null,
    stopRequested: false,
    createdAt,
    startedAt: null,
    finishedAt: null,
  }

  store.broadcasts[id] = broadcast
  return { success: true, broadcast: publicBroadcast(broadcast), raw: broadcast }
}

export function createBroadcastDraft(input = {}) {
  return withStore((store) => createBroadcastDraftOnStore(store, input))
}

export function getBroadcast(broadcastId) {
  return withStoreRead((store) => {
    const id = String(broadcastId || '').trim().toUpperCase()
    return publicBroadcast(store.broadcasts?.[id] || null)
  })
}

export function cancelBroadcastDraft(broadcastId, adminId) {
  return withStore((store) => {
    ensureMaps(store)
    const id = String(broadcastId || '').trim().toUpperCase()
    const row = store.broadcasts[id]
    if (!row) {
      return { success: false, code: 'NOT_FOUND' }
    }
    if (Number(row.adminId) !== Number(adminId)) {
      return { success: false, code: 'FORBIDDEN' }
    }
    if (row.status === BROADCAST_STATUS.DRAFT) {
      delete store.broadcasts[id]
      return { success: true, deleted: true }
    }
    if (
      row.status === BROADCAST_STATUS.QUEUED ||
      row.status === BROADCAST_STATUS.SENDING
    ) {
      row.stopRequested = true
      row.status = BROADCAST_STATUS.CANCELLED
      row.finishedAt = utcNow()
      return { success: true, cancelled: true, broadcast: publicBroadcast(row) }
    }
    return { success: false, code: 'INVALID_STATUS', broadcast: publicBroadcast(row) }
  })
}

/**
 * Atomic DRAFT → QUEUED. Only first caller wins.
 */
export function queueBroadcast(broadcastId, adminId, progressMeta = {}) {
  return withStore((store) => {
    ensureMaps(store)
    const id = String(broadcastId || '').trim().toUpperCase()
    const row = store.broadcasts[id]
    if (!row) {
      return { success: false, code: 'NOT_FOUND', message: 'Рассылка не найдена.' }
    }
    if (Number(row.adminId) !== Number(adminId)) {
      return { success: false, code: 'FORBIDDEN', message: 'Недостаточно прав.' }
    }
    if (row.status === BROADCAST_STATUS.QUEUED || row.status === BROADCAST_STATUS.SENDING) {
      return {
        success: false,
        code: 'ALREADY_STARTED',
        message: 'Рассылка уже запущена.',
        broadcast: publicBroadcast(row),
      }
    }
    if (row.status !== BROADCAST_STATUS.DRAFT) {
      return {
        success: false,
        code: 'INVALID_STATUS',
        message: 'Эту рассылку нельзя запустить.',
        broadcast: publicBroadcast(row),
      }
    }

    const startKey = `broadcast:queue:${id}`
    if (store.events[startKey]) {
      return {
        success: false,
        code: 'ALREADY_STARTED',
        message: 'Рассылка уже запущена.',
        broadcast: publicBroadcast(row),
      }
    }

    row.status = BROADCAST_STATUS.QUEUED
    row.startedAt = utcNow()
    row.progressChatId = progressMeta.chatId == null ? null : Number(progressMeta.chatId)
    row.progressMessageId =
      progressMeta.messageId == null ? null : Number(progressMeta.messageId)
    row.lastProgressAt = null

    store.events[startKey] = {
      eventId: startKey,
      broadcastId: id,
      adminId: Number(adminId),
      at: row.startedAt,
    }

    return { success: true, broadcast: publicBroadcast(row) }
  })
}

export function requestStopBroadcast(broadcastId, adminId) {
  return withStore((store) => {
    const id = String(broadcastId || '').trim().toUpperCase()
    const row = store.broadcasts?.[id]
    if (!row) {
      return { success: false, code: 'NOT_FOUND' }
    }
    if (Number(row.adminId) !== Number(adminId)) {
      return { success: false, code: 'FORBIDDEN' }
    }
    if (row.status !== BROADCAST_STATUS.QUEUED && row.status !== BROADCAST_STATUS.SENDING) {
      return { success: false, code: 'INVALID_STATUS', broadcast: publicBroadcast(row) }
    }
    row.stopRequested = true
    return { success: true, broadcast: publicBroadcast(row) }
  })
}

function isBlockedByUserError(result) {
  const desc = String(result?.description || '').toLowerCase()
  return (
    result?.errorCode === 403 ||
    desc.includes('bot was blocked by the user') ||
    desc.includes('user is deactivated') ||
    desc.includes('chat not found') ||
    desc.includes('peer_id_invalid')
  )
}

function formatProgressText(row) {
  const total = Array.isArray(row.recipientIds) ? row.recipientIds.length : Number(row.total) || 0
  const processed = Math.min(total, Number(row.nextIndex) || 0)
  const lines = [
    '📢 <b>Рассылка</b>',
    '',
    `Отправлено: <b>${processed}</b> / <b>${total}</b>`,
    `✅ Успешно: <b>${Number(row.sent) || 0}</b>`,
    `❌ Ошибки: <b>${Number(row.failed) || 0}</b>`,
  ]
  if (row.status === BROADCAST_STATUS.SENDING || row.status === BROADCAST_STATUS.QUEUED) {
    lines.push('', '⏳ Идёт отправка…')
  }
  return lines.join('\n')
}

function formatFinishedText(row) {
  const total = Array.isArray(row.recipientIds) ? row.recipientIds.length : Number(row.total) || 0
  const started = row.startedAt ? Date.parse(row.startedAt) : NaN
  const finished = row.finishedAt ? Date.parse(row.finishedAt) : Date.now()
  const seconds =
    Number.isFinite(started) && Number.isFinite(finished)
      ? Math.max(0, Math.round((finished - started) / 1000))
      : null
  const title =
    row.status === BROADCAST_STATUS.CANCELLED
      ? '⏹ <b>Рассылка остановлена</b>'
      : row.status === BROADCAST_STATUS.FAILED
        ? '❌ <b>Рассылка завершилась с ошибкой</b>'
        : '✅ <b>Рассылка завершена</b>'
  const lines = [
    title,
    '',
    `👥 Всего: <b>${total}</b>`,
    `✅ Успешно: <b>${Number(row.sent) || 0}</b>`,
    `❌ Ошибки: <b>${Number(row.failed) || 0}</b>`,
  ]
  if (seconds != null) {
    lines.push(`⏱ Время: <b>${seconds} сек.</b>`)
  }
  return lines.join('\n')
}

async function updateProgressMessage(row, { finished = false } = {}) {
  const chatId = row.progressChatId
  const messageId = row.progressMessageId
  if (!chatId || !messageId) {
    return
  }
  const text = finished ? formatFinishedText(row) : formatProgressText(row)
  const markup =
    finished || row.status === BROADCAST_STATUS.CANCELLED
      ? { inline_keyboard: [[{ text: '◀️ В админ-меню', callback_data: 'admin:root' }]] }
      : {
          inline_keyboard: [[{ text: '⏹ Остановить', callback_data: `bc:stop:${row.id}` }]],
        }

  await editTelegramMessageText(chatId, messageId, text, { reply_markup: markup }).catch(() => null)
}

/**
 * Claim next recipient under store lock. Returns null when idle/paused/done.
 */
function claimNextSend() {
  return withStore((store) => {
    ensureMaps(store)
    const active = Object.values(store.broadcasts).find(
      (row) =>
        row &&
        (row.status === BROADCAST_STATUS.QUEUED || row.status === BROADCAST_STATUS.SENDING),
    )
    if (!active) {
      return null
    }

    if (active.stopRequested) {
      active.status = BROADCAST_STATUS.CANCELLED
      active.finishedAt = utcNow()
      return { kind: 'finished', broadcast: { ...active } }
    }

    if (active.pauseUntil) {
      const until = Date.parse(active.pauseUntil)
      if (Number.isFinite(until) && until > Date.now()) {
        return { kind: 'paused', waitMs: until - Date.now() }
      }
      active.pauseUntil = null
    }

    const recipients = Array.isArray(active.recipientIds) ? active.recipientIds : []
    const index = Math.max(0, Math.floor(Number(active.nextIndex) || 0))
    if (index >= recipients.length) {
      active.status = BROADCAST_STATUS.COMPLETED
      active.finishedAt = utcNow()
      return { kind: 'finished', broadcast: { ...active } }
    }

    active.status = BROADCAST_STATUS.SENDING
    const chatId = recipients[index]
    return {
      kind: 'send',
      broadcastId: active.id,
      index,
      chatId,
      sourceChatId: active.sourceChatId,
      sourceMessageId: active.sourceMessageId,
      adminId: active.adminId,
      sent: Number(active.sent) || 0,
      failed: Number(active.failed) || 0,
      total: recipients.length,
      progressChatId: active.progressChatId,
      progressMessageId: active.progressMessageId,
      lastProgressAt: active.lastProgressAt,
    }
  })
}

function applySendResult(broadcastId, index, outcome) {
  return withStore((store) => {
    const row = store.broadcasts?.[String(broadcastId).toUpperCase()]
    if (!row) {
      return null
    }

    // Advance only if still at this index (idempotent under restart).
    const current = Math.max(0, Math.floor(Number(row.nextIndex) || 0))
    if (current !== index) {
      return publicBroadcast(row)
    }

    if (outcome === 'ok') {
      row.sent = (Number(row.sent) || 0) + 1
    } else if (outcome === 'blocked') {
      row.failed = (Number(row.failed) || 0) + 1
      row.blocked = (Number(row.blocked) || 0) + 1
      const tid = row.recipientIds?.[index]
      const user = tid != null ? store.users[String(tid)] : null
      if (user) {
        user.botBlocked = true
        user.botBlockedAt = utcNow()
      }
    } else if (outcome === 'fail') {
      row.failed = (Number(row.failed) || 0) + 1
    }

    row.nextIndex = index + 1

    if (row.stopRequested) {
      row.status = BROADCAST_STATUS.CANCELLED
      row.finishedAt = utcNow()
    } else if (row.nextIndex >= (row.recipientIds?.length || 0)) {
      row.status = BROADCAST_STATUS.COMPLETED
      row.finishedAt = utcNow()
    }

    return { ...row }
  })
}

function applyRetryPause(broadcastId, retryAfterSec) {
  return withStore((store) => {
    const row = store.broadcasts?.[String(broadcastId).toUpperCase()]
    if (!row) {
      return
    }
    const wait = Math.max(1, Math.floor(Number(retryAfterSec) || 1))
    row.pauseUntil = new Date(Date.now() + wait * 1000).toISOString()
  })
}

function shouldUpdateProgress(claim) {
  const sentLike = (Number(claim.sent) || 0) + (Number(claim.failed) || 0)
  if (sentLike > 0 && sentLike % PROGRESS_EVERY_N === 0) {
    return true
  }
  const last = claim.lastProgressAt ? Date.parse(claim.lastProgressAt) : 0
  return !Number.isFinite(last) || Date.now() - last >= PROGRESS_EVERY_MS
}

function markProgressTouched(broadcastId) {
  withStore((store) => {
    const row = store.broadcasts?.[String(broadcastId).toUpperCase()]
    if (row) {
      row.lastProgressAt = utcNow()
    }
  })
}

async function processOneTick() {
  const claim = claimNextSend()
  if (!claim) {
    return
  }

  if (claim.kind === 'paused') {
    return
  }

  if (claim.kind === 'finished') {
    await updateProgressMessage(claim.broadcast, { finished: true })
    return
  }

  const result = await copyTelegramMessage(claim.chatId, claim.sourceChatId, claim.sourceMessageId)

  if (result.ok) {
    const updated = applySendResult(claim.broadcastId, claim.index, 'ok')
    if (updated && (updated.status === BROADCAST_STATUS.COMPLETED || updated.status === BROADCAST_STATUS.CANCELLED)) {
      await updateProgressMessage(updated, { finished: true })
    } else if (shouldUpdateProgress(claim)) {
      markProgressTouched(claim.broadcastId)
      const snap = getBroadcast(claim.broadcastId)
      if (snap) {
        // Re-read raw-ish via store for progress text fields
        const raw = withStoreRead((store) => store.broadcasts[String(claim.broadcastId).toUpperCase()])
        if (raw) {
          await updateProgressMessage(raw, { finished: false })
        }
      }
    }
    return
  }

  if (result.status === 429 || result.retryAfter) {
    applyRetryPause(claim.broadcastId, result.retryAfter || 3)
    return
  }

  if (isBlockedByUserError(result)) {
    const updated = applySendResult(claim.broadcastId, claim.index, 'blocked')
    if (updated && (updated.status === BROADCAST_STATUS.COMPLETED || updated.status === BROADCAST_STATUS.CANCELLED)) {
      await updateProgressMessage(updated, { finished: true })
    }
    return
  }

  // Transient 5xx — limited soft retry by not advancing index, with pause.
  const desc = String(result.description || '')
  const status = Number(result.status) || 0
  if (status >= 500 || /internal|timeout|restart/i.test(desc)) {
    const retries = withStore((store) => {
      const row = store.broadcasts?.[String(claim.broadcastId).toUpperCase()]
      if (!row) {
        return MAX_RETRIES
      }
      row.retries = row.retries || {}
      const key = String(claim.index)
      row.retries[key] = (Number(row.retries[key]) || 0) + 1
      return row.retries[key]
    })
    if (retries < MAX_RETRIES) {
      applyRetryPause(claim.broadcastId, 2)
      return
    }
  }

  const updated = applySendResult(claim.broadcastId, claim.index, 'fail')
  if (updated && (updated.status === BROADCAST_STATUS.COMPLETED || updated.status === BROADCAST_STATUS.CANCELLED)) {
    await updateProgressMessage(updated, { finished: true })
  }
}

export async function broadcastSchedulerTick() {
  if (tickBusy) {
    return
  }
  tickBusy = true
  try {
    await processOneTick()
  } catch (error) {
    console.error('[broadcast] tick failed', {
      message: error instanceof Error ? error.message : 'unknown_error',
    })
  } finally {
    tickBusy = false
  }
}

export function startBroadcastScheduler({ intervalMs = TICK_MS } = {}) {
  if (schedulerTimer) {
    return schedulerTimer
  }
  const ms = Math.max(40, Number(intervalMs) || TICK_MS)
  schedulerTimer = setInterval(() => {
    void broadcastSchedulerTick()
  }, ms)
  if (typeof schedulerTimer.unref === 'function') {
    schedulerTimer.unref()
  }
  console.info('[broadcast] scheduler started', {
    intervalMs: ms,
    ratePerSec: BROADCAST_RATE_LIMIT_PER_SEC,
  })
  // Resume any SENDING/QUEUED jobs after restart.
  void broadcastSchedulerTick()
  return schedulerTimer
}

export function stopBroadcastScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
}

export function listRecentBroadcasts(limit = 10) {
  return withStoreRead((store) =>
    Object.values(store.broadcasts || {})
      .map((row) => publicBroadcast(row))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, Math.max(1, limit)),
  )
}
