import crypto from 'node:crypto'

import {
  checkGiveawayEligibility,
  normalizeGiveawayEligibility,
  resolveGiveawayEligibility,
} from './giveaway-eligibility.mjs'
import { createNotificationOnStore, NOTIFICATION_TYPE } from './notifications.mjs'
import { withStore, withStoreRead } from './store.mjs'
import { getAdminNotifyChatIds, sendTelegramMessage } from './telegram-notify.mjs'
import { addCoins, hasEvent, TX_TYPE, utcNow } from './wallet.mjs'

export {
  checkGiveawayEligibility,
  GIVEAWAY_ELIGIBILITY,
  GIVEAWAY_ELIGIBILITY_CONFIG,
  getEligibilityConfig,
  normalizeGiveawayEligibility,
  resolveGiveawayEligibility,
} from './giveaway-eligibility.mjs'

const GIVEAWAY_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/
const TITLE_MAX = 160
const DESCRIPTION_MAX = 2000
const IMAGE_MAX = 500
/** Telegram file_id length; keep generous — IDs vary by file type. */
const IMAGE_FILE_ID_MAX = 512
const WINNERS_MIN = 1
const WINNERS_MAX = 1000
const DEFAULT_SCHEDULER_MS = 45_000

let schedulerStarted = false
let schedulerTimer = null

function logGiveaway(event, details = {}) {
  console.info(`[giveaway] ${event}`, details)
}

function ensureGiveawayMaps(store) {
  store.giveaways = store.giveaways || {}
  store.giveawayParticipants = store.giveawayParticipants || {}
}

export function participantKey(giveawayId, userId) {
  return `${giveawayId}:${userId}`
}

export function giveawayRewardEventId(giveawayId, userId) {
  return `giveaway:${giveawayId}:winner:${userId}`
}

export function giveawayWinnerNotificationKey(giveawayId, userId) {
  return `giveaway:${giveawayId}:winner:${userId}`
}

/** Normalize prize type. Legacy `text` maps to `custom`. */
export function normalizePrizeType(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  if (value === 'coins') {
    return 'coins'
  }
  if (value === 'custom' || value === 'text') {
    return 'custom'
  }
  return null
}

export function isCoinsPrize(giveaway) {
  return normalizePrizeType(giveaway?.prizeType) === 'coins'
}

export function isCustomPrize(giveaway) {
  return normalizePrizeType(giveaway?.prizeType) === 'custom'
}

export function resolvePrizeAmount(body) {
  if (body?.prizeAmount != null && body.prizeAmount !== '') {
    return body.prizeAmount
  }
  if (body?.coinsAmount != null && body.coinsAmount !== '') {
    return body.coinsAmount
  }
  return null
}

export function resolvePrizeText(body) {
  if (body?.prizeText != null && String(body.prizeText).trim()) {
    return String(body.prizeText).trim()
  }
  if (body?.customPrize != null && String(body.customPrize).trim()) {
    return String(body.customPrize).trim()
  }
  return ''
}

function parseIsoDate(value, field) {
  const raw = String(value || '').trim()
  if (!raw) {
    return { ok: false, code: 'INVALID_DATE', message: `Поле ${field} обязательно.`, field }
  }
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) {
    return { ok: false, code: 'INVALID_DATE', message: `Некорректная дата ${field}.`, field }
  }
  return { ok: true, value: new Date(ms).toISOString(), ms }
}

function parsePositiveInt(value, { field, min = 1, max = Number.MAX_SAFE_INTEGER }) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) {
    return {
      ok: false,
      code: 'INVALID_NUMBER',
      message: `Поле ${field} должно быть целым числом от ${min} до ${max}.`,
      field,
    }
  }
  return { ok: true, value: n }
}

export function validateGiveawayCreateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'INVALID_BODY', message: 'Нужен JSON-объект.' }
  }

  const title = String(body.title ?? '').trim()
  if (title.length < 1 || title.length > TITLE_MAX) {
    return {
      ok: false,
      code: 'INVALID_TITLE',
      message: `Название: 1–${TITLE_MAX} символов.`,
    }
  }

  const description = String(body.description ?? '').trim()
  if (description.length > DESCRIPTION_MAX) {
    return {
      ok: false,
      code: 'INVALID_DESCRIPTION',
      message: `Описание: максимум ${DESCRIPTION_MAX} символов.`,
    }
  }

  const image = String(body.image ?? '').trim()
  if (image.length < 1 || image.length > IMAGE_MAX) {
    return {
      ok: false,
      code: 'INVALID_IMAGE',
      message: `Изображение: 1–${IMAGE_MAX} символов.`,
    }
  }

  let imageFileId = null
  if (body.imageFileId != null && String(body.imageFileId).trim() !== '') {
    const rawId = String(body.imageFileId).trim()
    if (rawId.length > IMAGE_FILE_ID_MAX) {
      return {
        ok: false,
        code: 'INVALID_IMAGE_FILE_ID',
        message: `imageFileId: максимум ${IMAGE_FILE_ID_MAX} символов.`,
      }
    }
    imageFileId = rawId
  }

  const prizeTypeRaw = String(body.prizeType || '').trim()
  const prizeType = normalizePrizeType(prizeTypeRaw)
  if (!prizeType) {
    return {
      ok: false,
      code: 'INVALID_PRIZE_TYPE',
      message: 'prizeType должен быть coins или custom.',
    }
  }

  let prizeAmount = null
  let prizeText = null

  if (prizeType === 'coins') {
    const amount = parsePositiveInt(resolvePrizeAmount(body), {
      field: 'prizeAmount',
      min: 1,
      max: 1_000_000_000,
    })
    if (!amount.ok) {
      return amount
    }
    prizeAmount = amount.value
  } else {
    prizeText = resolvePrizeText(body)
    if (prizeText.length < 1 || prizeText.length > 500) {
      return {
        ok: false,
        code: 'INVALID_PRIZE_TEXT',
        message: 'Для своего приза укажите описание (1–500 символов).',
      }
    }
  }

  const winners = parsePositiveInt(body.winnersCount, {
    field: 'winnersCount',
    min: WINNERS_MIN,
    max: WINNERS_MAX,
  })
  if (!winners.ok) {
    return winners
  }

  const start = parseIsoDate(body.startAt, 'startAt')
  if (!start.ok) {
    return start
  }
  const end = parseIsoDate(body.endAt, 'endAt')
  if (!end.ok) {
    return end
  }
  if (end.ms <= start.ms) {
    return {
      ok: false,
      code: 'INVALID_DATE_RANGE',
      message: 'endAt должен быть позже startAt.',
    }
  }

  const now = Date.now()
  if (end.ms <= now) {
    return {
      ok: false,
      code: 'ALREADY_ENDED',
      message: 'Нельзя создать розыгрыш с endAt в прошлом.',
    }
  }

  let eligibility = 'all'
  if (body.eligibility != null && String(body.eligibility).trim() !== '') {
    const normalized = normalizeGiveawayEligibility(body.eligibility)
    if (!normalized) {
      return {
        ok: false,
        code: 'INVALID_ELIGIBILITY',
        message: 'eligibility должен быть all, category_a или category_b.',
      }
    }
    eligibility = normalized
  }

  return {
    ok: true,
    value: {
      title,
      description,
      image,
      imageFileId,
      prizeType,
      prizeAmount,
      prizeText,
      winnersCount: winners.value,
      startAt: start.value,
      endAt: end.value,
      eligibility,
    },
  }
}

export function validateGiveawayPatchInput(body, existing) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'INVALID_BODY', message: 'Нужен JSON-объект.' }
  }

  if (existing.status === 'completed') {
    return {
      ok: false,
      code: 'IMMUTABLE',
      message: 'Завершённый розыгрыш нельзя изменять.',
    }
  }

  const next = { ...existing }
  const forbidden = ['status', 'winnerIds', 'participantsCount', 'completedAt', 'id', 'createdAt']
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return {
        ok: false,
        code: 'FORBIDDEN_FIELD',
        message: `Поле ${key} нельзя менять через PATCH.`,
      }
    }
  }

  if (body.title !== undefined) {
    const title = String(body.title ?? '').trim()
    if (title.length < 1 || title.length > TITLE_MAX) {
      return { ok: false, code: 'INVALID_TITLE', message: `Название: 1–${TITLE_MAX} символов.` }
    }
    next.title = title
  }

  if (body.description !== undefined) {
    const description = String(body.description ?? '').trim()
    if (description.length > DESCRIPTION_MAX) {
      return {
        ok: false,
        code: 'INVALID_DESCRIPTION',
        message: `Описание: максимум ${DESCRIPTION_MAX} символов.`,
      }
    }
    next.description = description
  }

  if (body.image !== undefined) {
    const image = String(body.image ?? '').trim()
    if (image.length < 1 || image.length > IMAGE_MAX) {
      return { ok: false, code: 'INVALID_IMAGE', message: `Изображение: 1–${IMAGE_MAX} символов.` }
    }
    next.image = image
  }

  if (body.imageFileId !== undefined) {
    if (body.imageFileId == null || String(body.imageFileId).trim() === '') {
      next.imageFileId = null
    } else {
      const rawId = String(body.imageFileId).trim()
      if (rawId.length > IMAGE_FILE_ID_MAX) {
        return {
          ok: false,
          code: 'INVALID_IMAGE_FILE_ID',
          message: `imageFileId: максимум ${IMAGE_FILE_ID_MAX} символов.`,
        }
      }
      next.imageFileId = rawId
    }
  }

  if (body.winnersCount !== undefined) {
    const winners = parsePositiveInt(body.winnersCount, {
      field: 'winnersCount',
      min: WINNERS_MIN,
      max: WINNERS_MAX,
    })
    if (!winners.ok) {
      return winners
    }
    next.winnersCount = winners.value
  }

  if (body.prizeAmount !== undefined || body.prizeText !== undefined || body.prizeType !== undefined || body.coinsAmount !== undefined || body.customPrize !== undefined) {
    const prizeType =
      body.prizeType !== undefined
        ? normalizePrizeType(body.prizeType)
        : normalizePrizeType(existing.prizeType)
    if (!prizeType) {
      return {
        ok: false,
        code: 'INVALID_PRIZE_TYPE',
        message: 'prizeType должен быть coins или custom.',
      }
    }
    next.prizeType = prizeType
    if (prizeType === 'coins') {
      const amountRaw =
        body.prizeAmount !== undefined || body.coinsAmount !== undefined
          ? resolvePrizeAmount(body)
          : existing.prizeAmount
      const amount = parsePositiveInt(amountRaw, {
        field: 'prizeAmount',
        min: 1,
        max: 1_000_000_000,
      })
      if (!amount.ok) {
        return amount
      }
      next.prizeAmount = amount.value
      next.prizeText = null
    } else {
      const prizeText =
        body.prizeText !== undefined || body.customPrize !== undefined
          ? resolvePrizeText(body)
          : String(existing.prizeText ?? '').trim()
      if (prizeText.length < 1 || prizeText.length > 500) {
        return {
          ok: false,
          code: 'INVALID_PRIZE_TEXT',
          message: 'Для своего приза укажите описание (1–500 символов).',
        }
      }
      next.prizeText = prizeText
      next.prizeAmount = null
    }
  }

  if (body.startAt !== undefined) {
    const start = parseIsoDate(body.startAt, 'startAt')
    if (!start.ok) {
      return start
    }
    next.startAt = start.value
  }

  if (body.endAt !== undefined) {
    const end = parseIsoDate(body.endAt, 'endAt')
    if (!end.ok) {
      return end
    }
    next.endAt = end.value
  }

  if (Date.parse(next.endAt) <= Date.parse(next.startAt)) {
    return {
      ok: false,
      code: 'INVALID_DATE_RANGE',
      message: 'endAt должен быть позже startAt.',
    }
  }

  if (Number(existing.participantsCount) > 0) {
    // Keep prize/winners intact once people joined — avoid bait-and-switch.
    if (
      next.prizeType !== existing.prizeType ||
      next.prizeAmount !== existing.prizeAmount ||
      next.prizeText !== existing.prizeText ||
      next.winnersCount !== existing.winnersCount
    ) {
      return {
        ok: false,
        code: 'HAS_PARTICIPANTS',
        message: 'Нельзя менять приз или число победителей после появления участников.',
      }
    }
  }

  return { ok: true, value: next }
}

export function parseGiveawayId(raw) {
  const id = String(raw || '').trim()
  if (!GIVEAWAY_ID_RE.test(id)) {
    return null
  }
  return id
}

function createGiveawayId() {
  return `gw_${crypto.randomBytes(8).toString('hex')}`
}

/**
 * Cryptographically fair sample without replacement.
 */
export function pickRandomWinners(userIds, winnersCount) {
  const pool = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
  const count = Math.min(Math.max(0, Number(winnersCount) || 0), pool.length)
  const winners = []
  for (let i = 0; i < count; i += 1) {
    const idx = crypto.randomInt(0, pool.length)
    winners.push(pool[idx])
    pool.splice(idx, 1)
  }
  return winners
}

function listParticipantUserIds(store, giveawayId) {
  const gid = String(giveawayId)
  const ids = []
  for (const row of Object.values(store.giveawayParticipants || {})) {
    if (row && String(row.giveawayId) === gid) {
      ids.push(Number(row.userId))
    }
  }
  return ids
}

function isParticipating(store, giveawayId, userId) {
  if (!userId) {
    return false
  }
  return Boolean(store.giveawayParticipants?.[participantKey(giveawayId, userId)])
}

function publicWinner(store, userId) {
  const user = store.users?.[String(userId)]
  return {
    userId: Number(userId),
    username: user?.username || null,
    firstName: user?.firstName || null,
    photoUrl: user?.photoUrl || null,
  }
}

function prizeLabel(giveaway) {
  if (isCoinsPrize(giveaway)) {
    return `${Number(giveaway.prizeAmount || 0).toLocaleString('ru-RU')} монет`
  }
  return String(giveaway.prizeText || 'приз')
}

function buildWinnerInfo(store, userId) {
  const user = store.users?.[String(userId)]
  return {
    telegramId: Number(userId),
    username: user?.username ? String(user.username) : null,
    firstName: user?.firstName ? String(user.firstName) : null,
  }
}

function resolveDeliveryStatus(giveaway) {
  if (giveaway.prizeDeliveryStatus === 'pending' || giveaway.prizeDeliveryStatus === 'delivered') {
    return giveaway.prizeDeliveryStatus
  }
  if (giveaway.status !== 'completed') {
    return null
  }
  // Legacy completed coin giveaways without the field → delivered.
  return isCoinsPrize(giveaway) ? 'delivered' : 'pending'
}

export function toPublicGiveaway(store, giveaway, { userId = null, includeWinners = false } = {}) {
  if (!giveaway) {
    return null
  }

  const prizeType = normalizePrizeType(giveaway.prizeType) || giveaway.prizeType

  const imageFileId =
    giveaway.imageFileId != null && String(giveaway.imageFileId).trim()
      ? String(giveaway.imageFileId).trim()
      : null

  const base = {
    id: giveaway.id,
    title: giveaway.title,
    description: giveaway.description || '',
    image: giveaway.image,
    imageFileId,
    status: giveaway.status,
    prizeType,
    prizeAmount: giveaway.prizeAmount,
    prizeText: giveaway.prizeText,
    coinsAmount: isCoinsPrize(giveaway) ? giveaway.prizeAmount : null,
    customPrize: isCustomPrize(giveaway) ? giveaway.prizeText : null,
    winnersCount: Number(giveaway.winnersCount) || 0,
    participantsCount: Number(giveaway.participantsCount) || 0,
    eligibility: resolveGiveawayEligibility(giveaway),
    startAt: giveaway.startAt,
    endAt: giveaway.endAt,
    createdAt: giveaway.createdAt,
    completedAt: giveaway.completedAt || null,
    endedAt: giveaway.completedAt || giveaway.endAt,
  }

  if (userId != null) {
    base.isParticipating = isParticipating(store, giveaway.id, userId)
  }

  if (includeWinners && giveaway.status === 'completed') {
    const winnerIds = Array.isArray(giveaway.winnerIds) ? giveaway.winnerIds : []
    base.winners = winnerIds.map((id) => publicWinner(store, id))
  }

  return base
}

export function toAdminGiveaway(store, giveaway) {
  const publicRow = toPublicGiveaway(store, giveaway, { includeWinners: true })
  const winnersInfo = Array.isArray(giveaway.winnersInfo)
    ? giveaway.winnersInfo.map((row) => ({
        telegramId: Number(row.telegramId),
        username: row.username || null,
        firstName: row.firstName || null,
      }))
    : (Array.isArray(giveaway.winnerIds) ? giveaway.winnerIds : []).map((id) =>
        buildWinnerInfo(store, id),
      )

  const first = winnersInfo[0] || null
  return {
    ...publicRow,
    winnerIds: Array.isArray(giveaway.winnerIds) ? [...giveaway.winnerIds] : [],
    winnersInfo,
    winnerTelegramId: first?.telegramId ?? null,
    winnerUsername: first?.username ?? null,
    winnerFirstName: first?.firstName ?? null,
    prizeDeliveryStatus: resolveDeliveryStatus(giveaway),
    createdBy: giveaway.createdBy || null,
  }
}

function resolveStatusForCreate(startAt, endAt, nowMs = Date.now()) {
  const startMs = Date.parse(startAt)
  const endMs = Date.parse(endAt)
  if (nowMs >= endMs) {
    return 'completed'
  }
  if (nowMs >= startMs) {
    return 'active'
  }
  // Not yet started — still listable as active for join gate via startAt check.
  return 'active'
}

export function createGiveawayOnStore(store, input, { createdBy = null, nowIso = utcNow() } = {}) {
  ensureGiveawayMaps(store)
  const validated = validateGiveawayCreateInput(input)
  if (!validated.ok) {
    return { success: false, code: validated.code, message: validated.message }
  }

  const data = validated.value
  const id = createGiveawayId()
  const nowMs = Date.parse(nowIso)
  const status = resolveStatusForCreate(data.startAt, data.endAt, nowMs)

  const row = {
    id,
    title: data.title,
    description: data.description,
    image: data.image,
    imageFileId: data.imageFileId || null,
    status,
    prizeType: data.prizeType,
    prizeAmount: data.prizeAmount,
    prizeText: data.prizeText,
    winnersCount: data.winnersCount,
    participantsCount: 0,
    eligibility: data.eligibility || 'all',
    startAt: data.startAt,
    endAt: data.endAt,
    createdAt: nowIso,
    completedAt: null,
    winnerIds: [],
    winnersInfo: [],
    prizeDeliveryStatus: null,
    createdBy: createdBy != null ? String(createdBy) : null,
  }

  store.giveaways[id] = row
  logGiveaway('created', { id, title: row.title, endAt: row.endAt })
  return { success: true, giveaway: toAdminGiveaway(store, row) }
}

export function updateGiveawayOnStore(store, giveawayId, body) {
  ensureGiveawayMaps(store)
  const id = parseGiveawayId(giveawayId)
  if (!id || !store.giveaways[id]) {
    return { success: false, code: 'NOT_FOUND', message: 'Розыгрыш не найден.' }
  }

  const existing = store.giveaways[id]
  const validated = validateGiveawayPatchInput(body, existing)
  if (!validated.ok) {
    return { success: false, code: validated.code, message: validated.message }
  }

  const next = validated.value
  store.giveaways[id] = {
    ...existing,
    title: next.title,
    description: next.description,
    image: next.image,
    imageFileId: next.imageFileId !== undefined ? next.imageFileId : existing.imageFileId || null,
    prizeType: next.prizeType,
    prizeAmount: next.prizeAmount,
    prizeText: next.prizeText,
    winnersCount: next.winnersCount,
    startAt: next.startAt,
    endAt: next.endAt,
  }

  return { success: true, giveaway: toAdminGiveaway(store, store.giveaways[id]) }
}

export function deleteGiveawayOnStore(store, giveawayId) {
  ensureGiveawayMaps(store)
  const id = parseGiveawayId(giveawayId)
  if (!id || !store.giveaways[id]) {
    return { success: false, code: 'NOT_FOUND', message: 'Розыгрыш не найден.' }
  }

  const row = store.giveaways[id]
  if (row.status === 'completed') {
    return {
      success: false,
      code: 'IMMUTABLE',
      message: 'Завершённый розыгрыш нельзя удалить.',
    }
  }

  if (Number(row.participantsCount) > 0) {
    return {
      success: false,
      code: 'HAS_PARTICIPANTS',
      message: 'Нельзя удалить розыгрыш, в котором уже есть участники.',
    }
  }

  delete store.giveaways[id]
  return { success: true, deleted: true, id }
}

function rewardWinnerOnStore(store, giveaway, userId) {
  const eventId = giveawayRewardEventId(giveaway.id, userId)
  const notifyKey = giveawayWinnerNotificationKey(giveaway.id, userId)
  const user = store.users?.[String(userId)]
  let coinsGranted = false
  let amount = 0
  const custom = isCustomPrize(giveaway)

  if (isCoinsPrize(giveaway)) {
    amount = Number(giveaway.prizeAmount) || 0
    if (user && amount > 0) {
      const result = addCoins(store, user, amount, TX_TYPE.GIVEAWAY_REWARD, eventId, {
        referenceId: giveaway.id,
        description: `Победа в розыгрыше: ${giveaway.title}`,
        giveawayId: giveaway.id,
      })
      coinsGranted = Boolean(result.granted) || result.reason === 'already_granted'
    } else if (hasEvent(store, eventId)) {
      coinsGranted = true
    }
  }

  const prizeMessage = custom
    ? `🎁 Приз:\n${prizeLabel(giveaway)}\n\nСвяжись с администрацией для получения приза.`
    : `Тебе начислено ${amount.toLocaleString('ru-RU')} монет.`

  const notificationTitle = custom ? '🎉 ПОЗДРАВЛЯЕМ!' : '🎉 Ты выиграл!'
  const notificationMessage = custom
    ? `Ты выиграл в розыгрыше!\n\n${prizeMessage}`
    : `Поздравляем! Ты выиграл в розыгрыше «${giveaway.title}». ${prizeMessage}`

  const notification = createNotificationOnStore(store, {
    userId,
    type: NOTIFICATION_TYPE.GIVEAWAY_WON,
    title: notificationTitle,
    message: notificationMessage,
    eventKey: notifyKey,
    relatedEntityType: 'giveaway',
    relatedEntityId: giveaway.id,
    metadata: {
      giveawayId: giveaway.id,
      prizeType: normalizePrizeType(giveaway.prizeType),
      prizeAmount: giveaway.prizeAmount,
      prizeText: giveaway.prizeText,
    },
  })

  logGiveaway('winner_rewarded', {
    giveawayId: giveaway.id,
    userId,
    prizeType: normalizePrizeType(giveaway.prizeType),
    coinsGranted,
    notificationCreated: Boolean(notification.created),
  })

  const telegramText = custom
    ? [
        '🎉 <b>ПОЗДРАВЛЯЕМ!</b>',
        '',
        'Ты выиграл в розыгрыше!',
        '',
        '🎁 Приз:',
        escapeHtml(prizeLabel(giveaway)),
        '',
        'Свяжись с администрацией для получения приза.',
      ].join('\n')
    : `🎉 Ты выиграл в розыгрыше «${escapeHtml(giveaway.title)}»!\n${escapeHtml(prizeMessage)}`

  return {
    userId: Number(userId),
    coinsGranted,
    amount,
    telegramText,
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function buildAdminCompletionJob(store, giveaway) {
  const winnersInfo = Array.isArray(giveaway.winnersInfo) ? giveaway.winnersInfo : []
  const prizeLine = isCoinsPrize(giveaway)
    ? `🪙 Приз: ${Number(giveaway.prizeAmount || 0).toLocaleString('ru-RU')} монет`
    : `🎁 Приз: ${escapeHtml(prizeLabel(giveaway))}`
  const deliveryLine = isCustomPrize(giveaway)
    ? '🎁 Выдача приза: ⏳ Не выдан'
    : '🎁 Выдача приза: ✅ Выдан'

  const winnerBlocks =
    winnersInfo.length === 0
      ? ['🏆 Победитель: —']
      : winnersInfo.map((winner, index) => {
          const label = winnersInfo.length > 1 ? `🏆 Победитель ${index + 1}:` : '🏆 Победитель:'
          const usernameLine = winner.username
            ? `👤 @${escapeHtml(winner.username)}`
            : '👤 Username: отсутствует'
          const nameLine = winner.firstName
            ? `Имя: ${escapeHtml(winner.firstName)}`
            : null
          return [
            label,
            usernameLine,
            nameLine,
            `🆔 Telegram ID: <code>${escapeHtml(String(winner.telegramId))}</code>`,
          ]
            .filter(Boolean)
            .join('\n')
        })

  const text = [
    '🏆 <b>РОЗЫГРЫШ ЗАВЕРШЁН</b>',
    '',
    prizeLine,
    `👥 Участников: ${Number(giveaway.participantsCount) || 0}`,
    '',
    ...winnerBlocks,
    '',
    deliveryLine,
    '',
    `ID: <code>${escapeHtml(giveaway.id)}</code>`,
  ].join('\n')

  const buttons = []
  if (isCustomPrize(giveaway)) {
    buttons.push([{ text: '✅ Приз выдан', callback_data: `gw:delivered:${giveaway.id}` }])
  }
  for (const winner of winnersInfo) {
    if (winner.username) {
      buttons.push([
        {
          text: winnersInfo.length > 1 ? `💬 @${winner.username}` : '💬 Открыть профиль победителя',
          url: `https://t.me/${encodeURIComponent(winner.username)}`,
        },
      ])
    }
  }

  return {
    kind: 'admin',
    text,
    reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
    giveawayId: giveaway.id,
  }
}

/**
 * Finalize a single giveaway atomically. Idempotent if already completed.
 */
export function finalizeGiveawayOnStore(store, giveawayId, { nowIso = utcNow() } = {}) {
  ensureGiveawayMaps(store)
  const id = parseGiveawayId(giveawayId) || String(giveawayId || '').trim()
  const giveaway = store.giveaways?.[id]
  if (!giveaway) {
    return { success: false, code: 'NOT_FOUND', message: 'Розыгрыш не найден.', telegramJobs: [] }
  }

  if (giveaway.status === 'completed') {
    return {
      success: true,
      alreadyCompleted: true,
      giveaway: toAdminGiveaway(store, giveaway),
      telegramJobs: [],
    }
  }

  const participantIds = listParticipantUserIds(store, id)
  const winnerIds = pickRandomWinners(participantIds, giveaway.winnersCount)
  const winnersInfo = winnerIds.map((uid) => buildWinnerInfo(store, uid))

  giveaway.status = 'completed'
  giveaway.completedAt = nowIso
  giveaway.winnerIds = winnerIds
  giveaway.winnersInfo = winnersInfo
  giveaway.participantsCount = participantIds.length
  giveaway.prizeDeliveryStatus = isCoinsPrize(giveaway) ? 'delivered' : 'pending'

  // Convenience single-winner mirrors for admin tooling.
  const first = winnersInfo[0] || null
  giveaway.winnerTelegramId = first?.telegramId ?? null
  giveaway.winnerUsername = first?.username ?? null
  giveaway.winnerFirstName = first?.firstName ?? null

  const telegramJobs = []
  for (const winnerId of winnerIds) {
    const rewarded = rewardWinnerOnStore(store, giveaway, winnerId)
    telegramJobs.push({
      kind: 'winner',
      userId: rewarded.userId,
      text: rewarded.telegramText,
    })
  }
  telegramJobs.push(buildAdminCompletionJob(store, giveaway))

  logGiveaway('finalized', {
    id,
    winners: winnerIds.length,
    participants: participantIds.length,
    prizeType: normalizePrizeType(giveaway.prizeType),
  })

  return {
    success: true,
    alreadyCompleted: false,
    giveaway: toAdminGiveaway(store, giveaway),
    telegramJobs,
  }
}

export function finalizeDueGiveawaysOnStore(store, { nowIso = utcNow() } = {}) {
  ensureGiveawayMaps(store)
  const nowMs = Date.parse(nowIso)
  const telegramJobs = []
  const finalized = []

  for (const giveaway of Object.values(store.giveaways)) {
    if (!giveaway || giveaway.status !== 'active') {
      continue
    }
    const endMs = Date.parse(giveaway.endAt)
    if (!Number.isFinite(endMs) || endMs > nowMs) {
      continue
    }
    const result = finalizeGiveawayOnStore(store, giveaway.id, { nowIso })
    if (result.success && !result.alreadyCompleted) {
      finalized.push(result.giveaway)
      telegramJobs.push(...(result.telegramJobs || []))
    }
  }

  return { success: true, finalized, telegramJobs }
}

export function participateOnStore(store, giveawayId, userId, { nowIso = utcNow() } = {}) {
  ensureGiveawayMaps(store)
  const id = parseGiveawayId(giveawayId)
  if (!id || !store.giveaways[id]) {
    return { success: false, code: 'NOT_FOUND', message: 'Розыгрыш не найден.' }
  }

  const giveaway = store.giveaways[id]
  const uid = Number(userId)
  if (!Number.isInteger(uid) || uid <= 0) {
    return { success: false, code: 'INVALID_USER', message: 'Некорректный пользователь.' }
  }

  if (!store.users?.[String(uid)]) {
    return { success: false, code: 'USER_MISSING', message: 'Сначала открой приложение.' }
  }

  const nowMs = Date.parse(nowIso)
  const endMs = Date.parse(giveaway.endAt)
  if (Number.isFinite(endMs) && endMs <= nowMs) {
    // Auto-finalize this giveaway, then reject participation.
    finalizeGiveawayOnStore(store, id, { nowIso })
    return {
      success: false,
      code: 'ENDED',
      message: 'Розыгрыш уже завершён.',
    }
  }

  if (giveaway.status !== 'active') {
    return { success: false, code: 'NOT_ACTIVE', message: 'Розыгрыш недоступен для участия.' }
  }

  const startMs = Date.parse(giveaway.startAt)
  if (Number.isFinite(startMs) && nowMs < startMs) {
    return { success: false, code: 'NOT_STARTED', message: 'Розыгрыш ещё не начался.' }
  }

  const key = participantKey(id, uid)
  if (store.giveawayParticipants[key]) {
    return {
      success: true,
      participating: true,
      alreadyParticipating: true,
      participantsCount: Number(giveaway.participantsCount) || 0,
      giveaway: toPublicGiveaway(store, giveaway, { userId: uid }),
    }
  }

  const user = store.users[String(uid)]
  const eligibilityCheck = checkGiveawayEligibility(user, giveaway)
  if (!eligibilityCheck.eligible) {
    return {
      success: false,
      code: 'GIVEAWAY_NOT_ELIGIBLE',
      requirement: eligibilityCheck.requirement,
      message: eligibilityCheck.message || 'Вы не можете участвовать в этом розыгрыше.',
      giveaway: toPublicGiveaway(store, giveaway, { userId: uid }),
    }
  }

  store.giveawayParticipants[key] = {
    id: key,
    giveawayId: id,
    userId: uid,
    username: store.users[String(uid)]?.username || null,
    firstName: store.users[String(uid)]?.firstName || null,
    joinedAt: nowIso,
  }
  giveaway.participantsCount = (Number(giveaway.participantsCount) || 0) + 1

  logGiveaway('participant_joined', { giveawayId: id, userId: uid })

  return {
    success: true,
    participating: true,
    alreadyParticipating: false,
    participantsCount: giveaway.participantsCount,
    giveaway: toPublicGiveaway(store, giveaway, { userId: uid }),
  }
}

function sortPublicGiveaways(list) {
  const active = list
    .filter((item) => item.status === 'active')
    .sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt))
  const completed = list
    .filter((item) => item.status === 'completed')
    .sort(
      (a, b) =>
        Date.parse(b.completedAt || b.endAt || 0) - Date.parse(a.completedAt || a.endAt || 0),
    )
  return [...active, ...completed]
}

export function listPublicGiveawaysOnStore(store, { userId = null } = {}) {
  ensureGiveawayMaps(store)
  const rows = Object.values(store.giveaways || {}).map((row) =>
    toPublicGiveaway(store, row, { userId, includeWinners: false }),
  )
  return sortPublicGiveaways(rows)
}

export function getPublicGiveawayOnStore(store, giveawayId, { userId = null } = {}) {
  ensureGiveawayMaps(store)
  const id = parseGiveawayId(giveawayId)
  if (!id || !store.giveaways[id]) {
    return null
  }
  return toPublicGiveaway(store, store.giveaways[id], {
    userId,
    includeWinners: true,
  })
}

export function listAdminGiveawaysOnStore(store) {
  ensureGiveawayMaps(store)
  return Object.values(store.giveaways || {})
    .map((row) => toAdminGiveaway(store, row))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
}

/* ── withStore wrappers ─────────────────────────────────────────── */

export function createGiveaway(input, options = {}) {
  return withStore((store) => createGiveawayOnStore(store, input, options))
}

export function updateGiveaway(giveawayId, body) {
  return withStore((store) => updateGiveawayOnStore(store, giveawayId, body))
}

export function deleteGiveaway(giveawayId) {
  return withStore((store) => deleteGiveawayOnStore(store, giveawayId))
}

export function listGiveaways({ userId = null } = {}) {
  const result = withStore((store) => {
    const telegramJobs = []
    const due = finalizeDueGiveawaysOnStore(store)
    telegramJobs.push(...(due.telegramJobs || []))
    const giveaways = listPublicGiveawaysOnStore(store, { userId })
    return { success: true, giveaways, telegramJobs }
  })
  return result
}

export function getGiveaway(giveawayId, { userId = null } = {}) {
  return withStore((store) => {
    const due = finalizeDueGiveawaysOnStore(store)
    const giveaway = getPublicGiveawayOnStore(store, giveawayId, { userId })
    if (!giveaway) {
      return {
        success: false,
        code: 'NOT_FOUND',
        message: 'Розыгрыш не найден.',
        telegramJobs: due.telegramJobs || [],
      }
    }
    return { success: true, giveaway, telegramJobs: due.telegramJobs || [] }
  })
}

export function participateGiveaway(giveawayId, userId) {
  return withStore((store) => {
    const due = finalizeDueGiveawaysOnStore(store)
    const result = participateOnStore(store, giveawayId, userId)
    return { ...result, telegramJobs: due.telegramJobs || [] }
  })
}

export function finalizeDueGiveaways() {
  return withStore((store) => finalizeDueGiveawaysOnStore(store))
}

export function finalizeGiveaway(giveawayId) {
  return withStore((store) => finalizeGiveawayOnStore(store, giveawayId))
}

export function listAdminGiveaways() {
  return withStore((store) => {
    const due = finalizeDueGiveawaysOnStore(store)
    return {
      success: true,
      giveaways: listAdminGiveawaysOnStore(store),
      telegramJobs: due.telegramJobs || [],
    }
  })
}

export async function notifyGiveawayTelegramJobs(jobs = [], options = {}) {
  for (const job of jobs) {
    if (!job?.text) {
      continue
    }

    try {
      if (job.kind === 'admin') {
        const chatIds = getAdminNotifyChatIds()
        for (const chatId of chatIds) {
          const result = await sendTelegramMessage(
            String(chatId),
            job.text,
            job.reply_markup ? { reply_markup: job.reply_markup } : {},
            options,
          )
          if (!result?.ok) {
            logGiveaway('notification_failed', {
              kind: 'admin',
              chatId: String(chatId),
              error: result?.error || 'unknown',
            })
          }
        }
        continue
      }

      if (!job.userId) {
        continue
      }
      const result = await sendTelegramMessage(String(job.userId), job.text, {}, options)
      if (!result?.ok) {
        logGiveaway('notification_failed', {
          userId: job.userId,
          error: result?.error || 'unknown',
        })
      }
    } catch (error) {
      logGiveaway('notification_failed', {
        kind: job.kind || 'winner',
        userId: job.userId || null,
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }
}

export function markPrizeDeliveredOnStore(store, giveawayId) {
  ensureGiveawayMaps(store)
  const id = parseGiveawayId(giveawayId)
  if (!id || !store.giveaways[id]) {
    return { success: false, code: 'NOT_FOUND', message: 'Розыгрыш не найден.' }
  }
  const giveaway = store.giveaways[id]
  if (giveaway.status !== 'completed') {
    return { success: false, code: 'NOT_COMPLETED', message: 'Розыгрыш ещё не завершён.' }
  }
  if (!isCustomPrize(giveaway)) {
    return {
      success: false,
      code: 'NOT_CUSTOM',
      message: 'Отмечать выдачу можно только для своего приза.',
    }
  }
  if (giveaway.prizeDeliveryStatus === 'delivered') {
    return {
      success: true,
      alreadyDelivered: true,
      giveaway: toAdminGiveaway(store, giveaway),
    }
  }
  giveaway.prizeDeliveryStatus = 'delivered'
  return {
    success: true,
    alreadyDelivered: false,
    giveaway: toAdminGiveaway(store, giveaway),
  }
}

export function markPrizeDelivered(giveawayId) {
  return withStore((store) => markPrizeDeliveredOnStore(store, giveawayId))
}

export function startGiveawayScheduler({ intervalMs = DEFAULT_SCHEDULER_MS } = {}) {
  if (schedulerStarted) {
    return { started: false, alreadyRunning: true }
  }
  schedulerStarted = true

  const tick = () => {
    try {
      const result = finalizeDueGiveaways()
      if (result?.telegramJobs?.length) {
        void notifyGiveawayTelegramJobs(result.telegramJobs)
      }
    } catch (error) {
      logGiveaway('scheduler_error', {
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  tick()
  schedulerTimer = setInterval(tick, intervalMs)
  if (typeof schedulerTimer.unref === 'function') {
    schedulerTimer.unref()
  }
  logGiveaway('scheduler_started', { intervalMs })
  return { started: true, alreadyRunning: false }
}

/** Test helper — stop scheduler between suites. */
export function stopGiveawayScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
  schedulerStarted = false
}

export function peekGiveaway(giveawayId) {
  return withStoreRead((store) => store.giveaways?.[String(giveawayId)] || null)
}
