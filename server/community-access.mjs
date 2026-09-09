import { withStore, withStoreRead } from './store.mjs'
import {
  assertSafeScreenshot,
  createSubmissionId,
  deleteCommunityScreenshot,
  resolveCommunityScreenshotPath,
  saveCommunityScreenshot,
} from './uploads.mjs'
import {
  notifyCommunityAccessApprovedOnStore,
  notifyCommunityAccessRejectedOnStore,
  validateRejectionReason,
} from './notifications.mjs'

const USERNAME_RE = /^@?[a-zA-Z0-9_]{5,32}$/
const REQUEST_ID_RE = /^[a-zA-Z0-9_-]{4,128}$/
const WELVURA_ID_RE = /^\d{1,32}$/

function ensureMaps(store) {
  store.communityAccessRequests = store.communityAccessRequests || {}
  store.events = store.events || {}
}

function utcNow() {
  return new Date().toISOString()
}

function normalizeWelvuraId(raw) {
  const value = String(raw || '').trim()
  if (!value) {
    return { ok: false, message: '❌ Укажите Welvura ID' }
  }
  if (value.length > 32) {
    return { ok: false, message: '❌ Welvura ID слишком длинный' }
  }
  if (/[<>&"'`\\/]|script|javascript:/i.test(value)) {
    return { ok: false, message: '❌ Некорректный Welvura ID' }
  }
  if (!WELVURA_ID_RE.test(value)) {
    return { ok: false, message: '❌ Welvura ID должен содержать только цифры' }
  }
  return { ok: true, value }
}

function normalizeUsername(raw) {
  const value = String(raw || '')
    .trim()
    .replace(/^@+/, '')
  if (!value) {
    return { ok: false, message: '❌ Укажите Telegram username' }
  }
  if (!USERNAME_RE.test(value) && !USERNAME_RE.test(`@${value}`)) {
    return {
      ok: false,
      message: '❌ Username некорректный. Пример: @username',
    }
  }
  if (value.length < 5 || value.length > 32 || !/^[a-zA-Z0-9_]+$/.test(value)) {
    return {
      ok: false,
      message: '❌ Username некорректный. Пример: @username',
    }
  }
  return { ok: true, value }
}

function publicRequest(row, { includeAdmin = false } = {}) {
  const base = {
    id: row.id,
    telegramId: Number(row.telegramId),
    welvuraId: row.welvuraId || null,
    username: row.username || null,
    firstName: row.firstName || null,
    status: row.status,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt || null,
    rejectionReason: row.rejectionReason || null,
  }
  if (!includeAdmin) {
    return base
  }
  return {
    ...base,
    reviewedBy: row.reviewedBy || null,
    screenshotPath: row.screenshotPath || null,
    screenshotMime: row.screenshotMime || null,
    inviteReady: Boolean(row.inviteReady),
  }
}

function findPendingForUser(store, telegramId) {
  return Object.values(store.communityAccessRequests || {}).find(
    (item) => Number(item.telegramId) === Number(telegramId) && item.status === 'pending',
  )
}

function findLatestForUser(store, telegramId) {
  return Object.values(store.communityAccessRequests || {})
    .filter((item) => Number(item.telegramId) === Number(telegramId))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0] || null
}

export function parseCommunityRequestId(raw) {
  const id = String(raw || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return null
  }
  return id
}

export function createCommunityAccessRequestOnStore(store, telegramUser, payload, file) {
  ensureMaps(store)

  const userId = Number(telegramUser?.id ?? telegramUser?.telegramId)
  if (!Number.isFinite(userId) || userId <= 0) {
    return { success: false, code: 'MISSING_TELEGRAM_ID', message: '❌ Telegram ID не найден' }
  }

  const clientRequestId = String(payload?.requestId || '').trim()
  if (!REQUEST_ID_RE.test(clientRequestId)) {
    return {
      success: false,
      code: 'MISSING_REQUEST_ID',
      message: 'Нужен requestId для этой операции.',
    }
  }

  const welvuraCheck = normalizeWelvuraId(payload?.welvuraId)
  if (!welvuraCheck.ok) {
    return { success: false, code: 'INVALID_WELVURA_ID', message: welvuraCheck.message }
  }

  const usernameCheck = normalizeUsername(
    payload?.username != null && String(payload.username).trim()
      ? payload.username
      : telegramUser?.username,
  )
  if (!usernameCheck.ok) {
    return { success: false, code: 'INVALID_USERNAME', message: usernameCheck.message }
  }

  const screenshotCheck = assertSafeScreenshot(
    file?.buffer,
    file?.mimetype,
    file?.originalname,
  )
  if (!screenshotCheck.ok) {
    return {
      success: false,
      code: 'INVALID_SCREENSHOT',
      message: screenshotCheck.message === 'Добавь скриншот.'
        ? '❌ Добавьте скриншот подтверждения'
        : `❌ ${screenshotCheck.message}`,
    }
  }

  const eventKey = `community-access:${userId}:${clientRequestId}`
  const existingEvent = store.events[eventKey]
  if (existingEvent?.requestId && store.communityAccessRequests[existingEvent.requestId]) {
    const existing = store.communityAccessRequests[existingEvent.requestId]
    if (Number(existing.telegramId) === userId) {
      return {
        success: true,
        alreadyExists: true,
        message:
          existing.status === 'pending'
            ? '⏳ Ваша заявка уже находится на проверке.'
            : 'Заявка уже обработана.',
        request: publicRequest(existing),
      }
    }
  }

  const pending = findPendingForUser(store, userId)
  if (pending) {
    return {
      success: false,
      code: 'PENDING_EXISTS',
      message: '⏳ Ваша заявка уже находится на проверке.',
      request: publicRequest(pending),
    }
  }

  const approved = Object.values(store.communityAccessRequests).find(
    (item) => Number(item.telegramId) === userId && item.status === 'approved',
  )
  if (approved) {
    return {
      success: false,
      code: 'ALREADY_APPROVED',
      message: '✅ Доступ уже одобрен.',
      request: publicRequest(approved),
    }
  }

  // Clean rejected screenshots for this user before new upload.
  for (const old of Object.values(store.communityAccessRequests)) {
    if (
      Number(old.telegramId) === userId &&
      old.status === 'rejected' &&
      old.screenshotPath
    ) {
      deleteCommunityScreenshot(old.screenshotPath)
      old.screenshotPath = null
      old.screenshotDeletedAt = utcNow()
    }
  }

  const id = createSubmissionId()
  let saved
  try {
    saved = saveCommunityScreenshot(id, file.buffer, screenshotCheck.type.ext)
  } catch (error) {
    return {
      success: false,
      code: 'UPLOAD_FAILED',
      message: 'Не удалось сохранить скриншот.',
      detail: error instanceof Error ? error.message : 'unknown',
    }
  }

  const user = store.users?.[String(userId)]
  const row = {
    id,
    telegramId: userId,
    welvuraId: welvuraCheck.value,
    username: usernameCheck.value,
    firstName:
      String(telegramUser?.first_name || telegramUser?.firstName || user?.firstName || '').trim() ||
      null,
    screenshotPath: saved.relativePath,
    screenshotMime: screenshotCheck.type.mime,
    status: 'pending',
    createdAt: utcNow(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    // Reserved for future invite-link delivery.
    inviteReady: false,
    inviteLink: null,
  }

  store.communityAccessRequests[id] = row
  store.events[eventKey] = {
    requestId: id,
    createdAt: row.createdAt,
  }

  return {
    success: true,
    message: 'Заявка отправлена.',
    request: publicRequest(row),
    // Absolute path helper for admin notify (not serialized to client).
    _absoluteScreenshotPath: saved.absolutePath,
  }
}

export function getCommunityAccessStatusOnStore(store, telegramId) {
  ensureMaps(store)
  const latest = findLatestForUser(store, telegramId)
  if (!latest) {
    return { success: true, request: null, canSubmit: true }
  }
  const canSubmit = latest.status === 'rejected'
  return {
    success: true,
    request: publicRequest(latest),
    canSubmit,
  }
}

export function approveCommunityAccessOnStore(store, requestId, reviewedBy) {
  ensureMaps(store)
  const id = parseCommunityRequestId(requestId)
  if (!id || !store.communityAccessRequests[id]) {
    return { success: false, code: 'NOT_FOUND', message: 'Заявка не найдена.' }
  }
  const row = store.communityAccessRequests[id]
  if (row.status === 'approved') {
    return {
      success: true,
      alreadyReviewed: true,
      message: 'Уже одобрено.',
      request: publicRequest(row, { includeAdmin: true }),
    }
  }
  if (row.status !== 'pending') {
    return {
      success: false,
      code: 'NOT_PENDING',
      message: 'Заявка уже обработана.',
      request: publicRequest(row, { includeAdmin: true }),
    }
  }

  row.status = 'approved'
  row.reviewedAt = utcNow()
  row.reviewedBy = reviewedBy != null ? String(reviewedBy) : null
  row.rejectionReason = null
  // Hook point for future invite link issuance.
  row.inviteReady = false

  notifyCommunityAccessApprovedOnStore(store, row)

  return {
    success: true,
    message: 'Заявка одобрена.',
    request: publicRequest(row, { includeAdmin: true }),
  }
}

export function rejectCommunityAccessOnStore(store, requestId, reviewedBy, reasonRaw) {
  ensureMaps(store)
  const id = parseCommunityRequestId(requestId)
  if (!id || !store.communityAccessRequests[id]) {
    return { success: false, code: 'NOT_FOUND', message: 'Заявка не найдена.' }
  }
  const row = store.communityAccessRequests[id]
  if (row.status === 'rejected') {
    return {
      success: true,
      alreadyReviewed: true,
      message: 'Уже отклонено.',
      request: publicRequest(row, { includeAdmin: true }),
    }
  }
  if (row.status !== 'pending') {
    return {
      success: false,
      code: 'NOT_PENDING',
      message: 'Заявка уже обработана.',
      request: publicRequest(row, { includeAdmin: true }),
    }
  }

  const reason = validateRejectionReason(reasonRaw)
  if (!reason.ok) {
    return { success: false, code: reason.code, message: reason.message }
  }

  row.status = 'rejected'
  row.reviewedAt = utcNow()
  row.reviewedBy = reviewedBy != null ? String(reviewedBy) : null
  row.rejectionReason = reason.value

  notifyCommunityAccessRejectedOnStore(store, row)

  return {
    success: true,
    message: 'Заявка отклонена.',
    request: publicRequest(row, { includeAdmin: true }),
  }
}

export function listAdminCommunityAccessOnStore(store, statusFilter = '') {
  ensureMaps(store)
  const filter = String(statusFilter || '')
    .trim()
    .toLowerCase()
  return Object.values(store.communityAccessRequests)
    .filter((row) => (filter ? row.status === filter : true))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .map((row) => publicRequest(row, { includeAdmin: true }))
}

export function getCommunityScreenshotOnStore(store, requestId, { viewerUserId = null, isAdmin = false } = {}) {
  ensureMaps(store)
  const id = parseCommunityRequestId(requestId)
  if (!id || !store.communityAccessRequests[id]) {
    return { success: false, message: 'Заявка не найдена.' }
  }
  const row = store.communityAccessRequests[id]
  if (!isAdmin && Number(row.telegramId) !== Number(viewerUserId)) {
    return { success: false, message: 'Нет доступа.' }
  }
  if (!row.screenshotPath) {
    return { success: false, message: 'Скриншот недоступен.' }
  }
  const absolutePath = resolveCommunityScreenshotPath(row.screenshotPath)
  if (!absolutePath) {
    return { success: false, message: 'Скриншот не найден.' }
  }
  return {
    success: true,
    absolutePath,
    mime: row.screenshotMime || 'image/jpeg',
  }
}

export function getAdminCommunityRequestOnStore(store, requestId) {
  ensureMaps(store)
  const id = parseCommunityRequestId(requestId)
  if (!id || !store.communityAccessRequests[id]) {
    return { success: false, code: 'NOT_FOUND', message: 'Заявка не найдена.' }
  }
  return {
    success: true,
    request: publicRequest(store.communityAccessRequests[id], { includeAdmin: true }),
  }
}

/* ── withStore wrappers ─────────────────────────────────────────── */

export function createCommunityAccessRequest(telegramUser, payload, file) {
  return withStore((store) => createCommunityAccessRequestOnStore(store, telegramUser, payload, file))
}

export function getCommunityAccessStatus(telegramId) {
  return withStoreRead((store) => getCommunityAccessStatusOnStore(store, telegramId))
}

export function approveCommunityAccess(requestId, reviewedBy) {
  return withStore((store) => approveCommunityAccessOnStore(store, requestId, reviewedBy))
}

export function rejectCommunityAccess(requestId, reviewedBy, reason) {
  return withStore((store) => rejectCommunityAccessOnStore(store, requestId, reviewedBy, reason))
}

export function listAdminCommunityAccess(statusFilter = '') {
  return withStoreRead((store) => ({
    success: true,
    requests: listAdminCommunityAccessOnStore(store, statusFilter),
  }))
}

export function getCommunityScreenshot(requestId, options = {}) {
  return withStoreRead((store) => getCommunityScreenshotOnStore(store, requestId, options))
}

export function getAdminCommunityRequest(requestId) {
  return withStoreRead((store) => getAdminCommunityRequestOnStore(store, requestId))
}

export function peekCommunityAccessRequest(requestId) {
  return withStoreRead((store) => store.communityAccessRequests?.[String(requestId)] || null)
}
