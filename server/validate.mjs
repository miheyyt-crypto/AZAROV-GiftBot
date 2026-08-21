import { HttpError } from './errors.mjs'
import { findPartnerTask, PARTNER_TASKS } from './partners.mjs'
import { findProduct } from './products.mjs'

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,128}$/
const ENTITY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const ORDER_ID_RE = /^[A-Z0-9]{4,32}$/
const CASE_IDS = new Set(['poor', 'medium', 'rich', 'referral'])
const COIN_HISTORY_FILTERS = new Set(['all', 'income', 'expense'])
const METADATA_KEYS = new Set(['telegramUsername', 'usdtAddress', 'kickUsername'])

const FORBIDDEN_CLIENT_KEYS = new Set([
  'balance',
  'balanceAfter',
  'reward',
  'rewardAmount',
  'price',
  'completed',
  'amount',
  'telegramId',
  'userId',
  'id',
  'chance',
  'rewards',
  'type',
  'transactionType',
  'transaction',
])

export function assertNoClientFinancialOverrides(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return
  }

  for (const key of Object.keys(body)) {
    if (FORBIDDEN_CLIENT_KEYS.has(key)) {
      throw new HttpError(400, 'Некорректные данные запроса.', 'INVALID_PAYLOAD')
    }
  }
}

export function parseRequestId(value, { required = true } = {}) {
  if (value == null || value === '') {
    if (required) {
      throw new HttpError(400, 'Нужен requestId для этой операции.', 'MISSING_REQUEST_ID')
    }
    return ''
  }

  if (typeof value !== 'string' || !REQUEST_ID_RE.test(value.trim())) {
    throw new HttpError(400, 'Некорректный requestId.', 'INVALID_REQUEST_ID')
  }

  return value.trim()
}

export function parseProductId(value) {
  if (typeof value !== 'string' || !ENTITY_ID_RE.test(value.trim())) {
    throw new HttpError(400, 'Некорректный productId.', 'INVALID_PRODUCT_ID')
  }

  const productId = value.trim()
  if (!findProduct(productId)) {
    throw new HttpError(404, 'Товар не найден.', 'PRODUCT_NOT_FOUND')
  }

  return productId
}

export function parseCaseId(value) {
  if (typeof value !== 'string' || !ENTITY_ID_RE.test(value.trim())) {
    throw new HttpError(400, 'Некорректный caseId.', 'INVALID_CASE_ID')
  }

  const caseId = value.trim()
  if (!CASE_IDS.has(caseId)) {
    throw new HttpError(404, 'Кейс не найден.', 'CASE_NOT_FOUND')
  }

  return caseId
}

export function parsePartnerTaskId(value) {
  if (typeof value !== 'string' || !ENTITY_ID_RE.test(value.trim())) {
    throw new HttpError(400, 'Некорректный taskId.', 'INVALID_TASK_ID')
  }

  const taskId = value.trim()
  if (!findPartnerTask(taskId)) {
    throw new HttpError(404, 'Задание партнёра не найдено.', 'TASK_NOT_FOUND')
  }

  return taskId
}

export function parsePartnerId(value) {
  if (typeof value !== 'string' || !ENTITY_ID_RE.test(value.trim())) {
    throw new HttpError(400, 'Некорректный partnerId.', 'INVALID_PARTNER_ID')
  }

  const partnerId = value.trim()
  if (!PARTNER_TASKS[partnerId]) {
    throw new HttpError(404, 'Партнёр не найден.', 'PARTNER_NOT_FOUND')
  }

  return partnerId
}

export function parseOrderId(value) {
  if (typeof value !== 'string' || !ORDER_ID_RE.test(value.trim())) {
    throw new HttpError(400, 'Некорректный orderId.', 'INVALID_ORDER_ID')
  }

  return value.trim()
}

export function parseCoinHistoryFilter(value) {
  const filter = typeof value === 'string' && value.trim() ? value.trim() : 'all'
  if (!COIN_HISTORY_FILTERS.has(filter)) {
    throw new HttpError(400, 'Некорректный фильтр.', 'INVALID_FILTER')
  }
  return filter
}

export function sanitizePurchaseMetadata(metadata) {
  const safe = {}
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return safe
  }

  for (const key of METADATA_KEYS) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) {
      safe[key] = value.trim().slice(0, 256)
    }
  }

  return safe
}

export function parsePositiveIntAmount(value, fieldName = 'amount') {
  const amount = Number(value)
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpError(400, `Некорректное значение ${fieldName}.`, 'INVALID_AMOUNT')
  }
  return amount
}
