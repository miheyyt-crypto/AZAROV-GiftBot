import crypto from 'node:crypto'

import { withStore, withStoreRead } from './store.mjs'
import { utcNow } from './wallet.mjs'

export const WITHDRAWAL_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  REJECTED: 'REJECTED',
}

export const ITEM_WITHDRAWAL_STATUS = {
  AVAILABLE: 'AVAILABLE',
  PENDING_WITHDRAWAL: 'PENDING_WITHDRAWAL',
  WITHDRAWN: 'WITHDRAWN',
}

export const WITHDRAWAL_METHOD = 'WELVURA'

const WELVURA_ID_RE = /^\d{1,32}$/

function ensureMaps(store) {
  store.withdrawals = store.withdrawals || {}
  store.caseOpenings = store.caseOpenings || {}
  store.events = store.events || {}
  store.users = store.users || {}
}

export function normalizeWelvuraId(raw) {
  return String(raw || '')
    .trim()
    .replace(/\D/g, '')
}

export function isValidWelvuraId(raw) {
  return WELVURA_ID_RE.test(normalizeWelvuraId(raw))
}

/** @deprecated kept for older imports; use isValidWelvuraId */
export function isValidTronAddress(raw) {
  return isValidWelvuraId(raw)
}

export function generateWithdrawalId(store) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const id = `WD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    if (!store.withdrawals[id]) {
      return id
    }
  }
  throw new Error('withdrawal_id_collision')
}

function findUserOpening(user, itemId) {
  const id = String(itemId || '')
  const openings = Array.isArray(user?.caseOpenings) ? user.caseOpenings : []
  return openings.find((row) => String(row.openingId) === id) || null
}

function syncOpeningFields(store, user, opening, patch) {
  Object.assign(opening, patch)
  const stored = store.caseOpenings?.[opening.openingId]
  if (stored) {
    Object.assign(stored, patch)
  }
  const list = Array.isArray(user.caseOpenings) ? user.caseOpenings : []
  const idx = list.findIndex((row) => String(row.openingId) === String(opening.openingId))
  if (idx >= 0 && list[idx] !== opening) {
    Object.assign(list[idx], patch)
  }
}

export function resolveItemWithdrawalStatus(opening, store) {
  if (!opening) {
    return ITEM_WITHDRAWAL_STATUS.AVAILABLE
  }
  const explicit = String(opening.withdrawalStatus || '').toUpperCase()
  if (
    explicit === ITEM_WITHDRAWAL_STATUS.PENDING_WITHDRAWAL ||
    explicit === ITEM_WITHDRAWAL_STATUS.WITHDRAWN ||
    explicit === ITEM_WITHDRAWAL_STATUS.AVAILABLE
  ) {
    return explicit
  }

  const activeId = opening.activeWithdrawalId
  if (activeId && store?.withdrawals?.[activeId]) {
    const status = String(store.withdrawals[activeId].status || '').toUpperCase()
    if (status === WITHDRAWAL_STATUS.PENDING) {
      return ITEM_WITHDRAWAL_STATUS.PENDING_WITHDRAWAL
    }
    if (status === WITHDRAWAL_STATUS.PAID) {
      return ITEM_WITHDRAWAL_STATUS.WITHDRAWN
    }
  }
  return ITEM_WITHDRAWAL_STATUS.AVAILABLE
}

export function publicWithdrawal(row) {
  if (!row) {
    return null
  }
  const welvuraId = row.welvuraId || row.walletAddress || ''
  return {
    id: row.id,
    userId: Number(row.userId),
    itemId: row.itemId,
    amountRub: Math.floor(Number(row.amountRub) || 0),
    currency: row.currency || 'RUB',
    method: row.method || WITHDRAWAL_METHOD,
    welvuraId,
    // Legacy alias for older clients / admin helpers.
    walletAddress: welvuraId,
    status: row.status,
    itemName: row.itemName || null,
    createdAt: row.createdAt || null,
    processedAt: row.processedAt || null,
    processedBy: row.processedBy == null ? null : Number(row.processedBy),
  }
}

function recordAudit(store, eventId, payload) {
  store.events[eventId] = {
    eventId,
    ...payload,
    at: utcNow(),
  }
}

/**
 * Create a Welvura-ID withdrawal request for a RUB case prize (openingId = itemId).
 * Amount always comes from the opening — never from the client.
 */
export function createWithdrawalOnStore(store, userId, input = {}) {
  ensureMaps(store)

  const uid = Number(userId)
  if (!Number.isInteger(uid) || uid <= 0) {
    console.error('[WITHDRAWAL]', { stage: 'unauthorized' })
    return {
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Не удалось определить пользователя.',
    }
  }

  const itemId = String(input.itemId || '').trim()
  if (!itemId) {
    console.error('[WITHDRAWAL]', { stage: 'missing_item_id', userId: uid })
    return {
      success: false,
      code: 'ITEM_NOT_FOUND',
      message: 'Предмет недоступен.',
    }
  }

  const welvuraId = normalizeWelvuraId(input.welvuraId || input.walletAddress || '')
  if (!isValidWelvuraId(welvuraId)) {
    console.error('[WITHDRAWAL]', { stage: 'invalid_welvura_id', userId: uid, itemId })
    return {
      success: false,
      code: 'INVALID_WELVURA_ID',
      message: 'Укажи свой ID аккаунта Welvura (только цифры).',
    }
  }

  const user = store.users[String(uid)]
  if (!user) {
    return {
      success: false,
      code: 'USER_NOT_FOUND',
      message: 'Пользователь не найден.',
    }
  }

  const opening = findUserOpening(user, itemId)
  if (!opening) {
    return {
      success: false,
      code: 'ITEM_NOT_FOUND',
      message: 'Предмет недоступен.',
    }
  }

  const currency = String(opening.rewardCurrency || opening.prize?.currency || '').toUpperCase()
  if (currency !== 'RUB') {
    return {
      success: false,
      code: 'NOT_WITHDRAWABLE',
      message: 'Этот предмет нельзя вывести.',
    }
  }

  const amountRub = Math.floor(Number(opening.rewardAmount ?? opening.prize?.amount) || 0)
  if (amountRub < 1) {
    return {
      success: false,
      code: 'NOT_WITHDRAWABLE',
      message: 'Этот предмет нельзя вывести.',
    }
  }

  const itemStatus = resolveItemWithdrawalStatus(opening, store)
  if (itemStatus === ITEM_WITHDRAWAL_STATUS.PENDING_WITHDRAWAL) {
    return {
      success: false,
      code: 'ALREADY_PENDING',
      message: 'Для этого предмета уже создана заявка на вывод.',
    }
  }
  if (itemStatus === ITEM_WITHDRAWAL_STATUS.WITHDRAWN) {
    return {
      success: false,
      code: 'ALREADY_WITHDRAWN',
      message: 'Этот предмет уже выведен.',
    }
  }

  const existingPending = Object.values(store.withdrawals).find(
    (row) =>
      String(row.itemId) === itemId &&
      String(row.status).toUpperCase() === WITHDRAWAL_STATUS.PENDING,
  )
  if (existingPending) {
    return {
      success: false,
      code: 'ALREADY_PENDING',
      message: 'Для этого предмета уже создана заявка на вывод.',
      withdrawal: publicWithdrawal(existingPending),
    }
  }

  const id = generateWithdrawalId(store)
  const createdAt = utcNow()
  const itemName = opening.prize?.name || `${amountRub} ₽`

  const withdrawal = {
    id,
    userId: uid,
    itemId,
    amountRub,
    currency: 'RUB',
    method: WITHDRAWAL_METHOD,
    welvuraId,
    walletAddress: welvuraId,
    status: WITHDRAWAL_STATUS.PENDING,
    itemName,
    createdAt,
    processedAt: null,
    processedBy: null,
    rejectionReason: null,
  }

  store.withdrawals[id] = withdrawal
  syncOpeningFields(store, user, opening, {
    withdrawalStatus: ITEM_WITHDRAWAL_STATUS.PENDING_WITHDRAWAL,
    activeWithdrawalId: id,
  })

  recordAudit(store, `withdrawal:create:${id}`, {
    type: 'WITHDRAWAL_CREATED',
    withdrawalId: id,
    userId: uid,
    itemId,
    amountRub,
    method: WITHDRAWAL_METHOD,
    welvuraId,
  })

  return {
    success: true,
    code: 'OK',
    message: 'Заявка на вывод отправлена',
    withdrawal: publicWithdrawal(withdrawal),
  }
}

export function createWithdrawal(userId, input = {}) {
  return withStore((store) => createWithdrawalOnStore(store, userId, input))
}

export function approveWithdrawalOnStore(store, withdrawalId, adminId) {
  ensureMaps(store)
  const id = String(withdrawalId || '').trim().toUpperCase()
  const withdrawal = store.withdrawals[id]
  if (!withdrawal) {
    return { success: false, code: 'NOT_FOUND', message: 'Заявка не найдена.' }
  }

  const status = String(withdrawal.status || '').toUpperCase()
  if (status === WITHDRAWAL_STATUS.PAID) {
    return {
      success: true,
      alreadyProcessed: true,
      withdrawal: publicWithdrawal(withdrawal),
    }
  }
  if (status === WITHDRAWAL_STATUS.REJECTED) {
    return {
      success: false,
      code: 'ALREADY_REJECTED',
      message: 'Заявка уже отклонена.',
      withdrawal: publicWithdrawal(withdrawal),
    }
  }
  if (status !== WITHDRAWAL_STATUS.PENDING) {
    return {
      success: false,
      code: 'INVALID_STATUS',
      message: 'Заявка недоступна для подтверждения.',
    }
  }

  const approveKey = `withdrawal:approve:${id}`
  if (store.events[approveKey]) {
    return {
      success: true,
      alreadyProcessed: true,
      withdrawal: publicWithdrawal(withdrawal),
    }
  }

  withdrawal.status = WITHDRAWAL_STATUS.PAID
  withdrawal.processedAt = utcNow()
  withdrawal.processedBy = Number(adminId) || null

  const user = store.users[String(withdrawal.userId)]
  const opening = user ? findUserOpening(user, withdrawal.itemId) : null
  if (user && opening) {
    syncOpeningFields(store, user, opening, {
      withdrawalStatus: ITEM_WITHDRAWAL_STATUS.WITHDRAWN,
      activeWithdrawalId: id,
    })
  } else if (store.caseOpenings[withdrawal.itemId]) {
    store.caseOpenings[withdrawal.itemId].withdrawalStatus = ITEM_WITHDRAWAL_STATUS.WITHDRAWN
    store.caseOpenings[withdrawal.itemId].activeWithdrawalId = id
  }

  recordAudit(store, approveKey, {
    type: 'WITHDRAWAL_APPROVED',
    withdrawalId: id,
    userId: withdrawal.userId,
    itemId: withdrawal.itemId,
    amountRub: withdrawal.amountRub,
    adminId: Number(adminId) || null,
  })

  return {
    success: true,
    alreadyProcessed: false,
    withdrawal: publicWithdrawal(withdrawal),
  }
}

export function approveWithdrawal(withdrawalId, adminId) {
  return withStore((store) => approveWithdrawalOnStore(store, withdrawalId, adminId))
}

export function rejectWithdrawalOnStore(store, withdrawalId, adminId, reason = '') {
  ensureMaps(store)
  const id = String(withdrawalId || '').trim().toUpperCase()
  const withdrawal = store.withdrawals[id]
  if (!withdrawal) {
    return { success: false, code: 'NOT_FOUND', message: 'Заявка не найдена.' }
  }

  const status = String(withdrawal.status || '').toUpperCase()
  if (status === WITHDRAWAL_STATUS.REJECTED) {
    return {
      success: true,
      alreadyProcessed: true,
      withdrawal: publicWithdrawal(withdrawal),
    }
  }
  if (status === WITHDRAWAL_STATUS.PAID) {
    return {
      success: false,
      code: 'ALREADY_PAID',
      message: 'Заявка уже выплачена.',
      withdrawal: publicWithdrawal(withdrawal),
    }
  }
  if (status !== WITHDRAWAL_STATUS.PENDING) {
    return {
      success: false,
      code: 'INVALID_STATUS',
      message: 'Заявка недоступна для отклонения.',
    }
  }

  const rejectKey = `withdrawal:reject:${id}`
  if (store.events[rejectKey]) {
    return {
      success: true,
      alreadyProcessed: true,
      withdrawal: publicWithdrawal(withdrawal),
    }
  }

  withdrawal.status = WITHDRAWAL_STATUS.REJECTED
  withdrawal.processedAt = utcNow()
  withdrawal.processedBy = Number(adminId) || null
  withdrawal.rejectionReason = String(reason || '').slice(0, 240) || null

  const user = store.users[String(withdrawal.userId)]
  const opening = user ? findUserOpening(user, withdrawal.itemId) : null
  if (user && opening) {
    syncOpeningFields(store, user, opening, {
      withdrawalStatus: ITEM_WITHDRAWAL_STATUS.AVAILABLE,
      activeWithdrawalId: null,
    })
  } else if (store.caseOpenings[withdrawal.itemId]) {
    store.caseOpenings[withdrawal.itemId].withdrawalStatus = ITEM_WITHDRAWAL_STATUS.AVAILABLE
    store.caseOpenings[withdrawal.itemId].activeWithdrawalId = null
  }

  recordAudit(store, rejectKey, {
    type: 'WITHDRAWAL_REJECTED',
    withdrawalId: id,
    userId: withdrawal.userId,
    itemId: withdrawal.itemId,
    amountRub: withdrawal.amountRub,
    adminId: Number(adminId) || null,
  })

  return {
    success: true,
    alreadyProcessed: false,
    withdrawal: publicWithdrawal(withdrawal),
  }
}

export function rejectWithdrawal(withdrawalId, adminId, reason = '') {
  return withStore((store) => rejectWithdrawalOnStore(store, withdrawalId, adminId, reason))
}

export function getWithdrawal(withdrawalId) {
  return withStoreRead((store) => {
    const id = String(withdrawalId || '').trim().toUpperCase()
    return publicWithdrawal(store.withdrawals?.[id] || null)
  })
}

export function listUserWithdrawals(userId) {
  return withStoreRead((store) =>
    Object.values(store.withdrawals || {})
      .filter((row) => Number(row.userId) === Number(userId))
      .map((row) => publicWithdrawal(row))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
  )
}
