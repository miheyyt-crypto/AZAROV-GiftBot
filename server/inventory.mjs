import { STREAK_FREEZE_PRODUCT_ID } from './constants.mjs'
import { hasEvent, recordLedgerNote, TX_TYPE, utcNow } from './wallet.mjs'

export const INVENTORY_ITEM_TYPE = {
  STREAK_FREEZE: STREAK_FREEZE_PRODUCT_ID,
}

export const INVENTORY_STATUS = {
  AVAILABLE: 'available',
  CONSUMED: 'consumed',
}

export function ensureInventory(store) {
  store.inventory = store.inventory || {}
}

export function streakFreezeItemIdForOrder(orderId) {
  return `sf:${String(orderId)}`
}

export function inventoryGrantEventId(orderId) {
  return `shop:inventory:${String(orderId)}`
}

export function publicInventoryItem(item) {
  if (!item) {
    return null
  }
  return {
    itemId: item.itemId,
    type: item.type,
    status: item.status,
    sourceOrderId: item.sourceOrderId || null,
    createdAt: item.createdAt,
    consumedAt: item.consumedAt || null,
    metadata: item.metadata || {},
  }
}

export function findInventoryItemBySourceOrder(store, orderId) {
  ensureInventory(store)
  const key = String(orderId)
  const byId = store.inventory[streakFreezeItemIdForOrder(key)]
  if (byId) {
    return byId
  }
  return (
    Object.values(store.inventory).find((item) => item && String(item.sourceOrderId) === key) ||
    null
  )
}

/**
 * Idempotently grant one streak-freeze inventory item for an approved shop order.
 */
export function grantStreakFreezeInventoryOnStore(store, order) {
  ensureInventory(store)
  const orderId = String(order.orderId)
  const userId = Number(order.userId)
  const grantKey = inventoryGrantEventId(orderId)
  const itemId = streakFreezeItemIdForOrder(orderId)
  const existing = store.inventory[itemId] || findInventoryItemBySourceOrder(store, orderId)

  if (existing) {
    store.events = store.events || {}
    if (!store.events[grantKey]) {
      store.events[grantKey] = {
        eventId: grantKey,
        done: true,
        itemId: existing.itemId,
        orderId,
        userId,
        createdAt: existing.createdAt || utcNow(),
      }
    }
    const user = store.users[String(userId)]
    if (user) {
      user.inventoryIds = user.inventoryIds || []
      if (!user.inventoryIds.includes(existing.itemId)) {
        user.inventoryIds = [...user.inventoryIds, existing.itemId]
      }
    }
    return { created: false, item: existing, reason: 'already_granted' }
  }

  if (store.events?.[grantKey]?.itemId && store.inventory[store.events[grantKey].itemId]) {
    return {
      created: false,
      item: store.inventory[store.events[grantKey].itemId],
      reason: 'already_granted',
    }
  }

  const createdAt = utcNow()
  const item = {
    itemId,
    userId,
    type: INVENTORY_ITEM_TYPE.STREAK_FREEZE,
    status: INVENTORY_STATUS.AVAILABLE,
    sourceOrderId: orderId,
    createdAt,
    consumedAt: null,
    metadata: {},
  }

  store.inventory[itemId] = item
  store.events = store.events || {}
  store.events[grantKey] = {
    eventId: grantKey,
    done: true,
    itemId,
    orderId,
    userId,
    createdAt,
  }

  const user = store.users[String(userId)]
  if (user) {
    user.inventoryIds = user.inventoryIds || []
    if (!user.inventoryIds.includes(itemId)) {
      user.inventoryIds = [...user.inventoryIds, itemId]
    }
  }

  return { created: true, item, reason: 'granted' }
}

export function listAvailableStreakFreezeItems(store, telegramUserId) {
  ensureInventory(store)
  return Object.values(store.inventory)
    .filter((item) => {
      if (!item || Number(item.userId) !== Number(telegramUserId)) {
        return false
      }
      if (String(item.type) !== INVENTORY_ITEM_TYPE.STREAK_FREEZE) {
        return false
      }
      if (String(item.status) !== INVENTORY_STATUS.AVAILABLE) {
        return false
      }
      if (item.consumedAt || item.metadata?.consumedForDate) {
        return false
      }
      return true
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export function countAvailableStreakFreezes(store, telegramUserId) {
  return listAvailableStreakFreezeItems(store, telegramUserId).length
}

export function listUserInventoryItems(store, telegramUserId) {
  ensureInventory(store)
  const user = store.users[String(telegramUserId)]
  const ids = user?.inventoryIds || []
  const fromIds = ids.map((id) => store.inventory[id]).filter(Boolean)
  const extras = Object.values(store.inventory).filter(
    (item) => item && Number(item.userId) === Number(telegramUserId),
  )
  const byId = new Map()
  for (const item of [...fromIds, ...extras]) {
    byId.set(item.itemId, item)
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

/**
 * Consume oldest available streak-freeze inventory item for a calendar gap day.
 * Idempotent per (telegramId, activityDate) via ledger event id.
 */
export function consumeStreakFreezeInventoryOnStore(store, telegramUserId, activityDate, eventId) {
  if (hasEvent(store, eventId)) {
    return {
      consumed: false,
      reason: 'already_consumed_for_date',
      eventId,
      itemId: store.events[eventId]?.referenceId || null,
      orderId: store.events[eventId]?.orderId || null,
    }
  }

  const available = listAvailableStreakFreezeItems(store, telegramUserId)
  if (!available.length) {
    return { consumed: false, reason: 'no_freeze', eventId, itemId: null, orderId: null }
  }

  const user = store.users[String(telegramUserId)]
  if (!user) {
    return { consumed: false, reason: 'missing_user', eventId, itemId: null, orderId: null }
  }

  const item = available[0]
  const now = utcNow()
  item.status = INVENTORY_STATUS.CONSUMED
  item.consumedAt = now
  item.updatedAt = now
  item.metadata = {
    ...(item.metadata || {}),
    consumedForDate: String(activityDate),
    consumedReason: 'streak_gap',
  }

  const note = recordLedgerNote(store, user, TX_TYPE.STREAK_FREEZE, eventId, {
    referenceId: item.itemId,
    description: 'Заморозка стрика: стрик сохранён после пропуска одного дня',
  })

  if (!note.applied && note.reason === 'already_granted') {
    return {
      consumed: false,
      reason: 'already_consumed_for_date',
      eventId,
      itemId: item.itemId,
      orderId: item.sourceOrderId || null,
    }
  }

  // Keep orderId on the event for debugging (non-ledger field via events overlay).
  if (store.events[eventId]) {
    store.events[eventId].orderId = item.sourceOrderId || null
  }

  return {
    consumed: true,
    reason: 'consumed',
    eventId,
    itemId: item.itemId,
    orderId: item.sourceOrderId || null,
    transaction: note.transaction,
  }
}

/**
 * One-time migration: pending/processing streak-freeze orders → completed + inventory.
 * Idempotent per order via inventory grant event / item id.
 */
export function migrateLegacyStreakFreezeOrdersOnStore(store) {
  ensureInventory(store)
  store.orders = store.orders || {}
  store.events = store.events || {}

  const migrationKey = 'migration:streak-freeze-inventory-v1'
  let migrated = 0
  let skipped = 0

  for (const order of Object.values(store.orders)) {
    if (!order || String(order.productId) !== STREAK_FREEZE_PRODUCT_ID) {
      continue
    }

    const status = String(order.status || '')
      .trim()
      .toLowerCase()
    if (status !== 'pending' && status !== 'processing') {
      skipped += 1
      continue
    }

    // Already consumed via old path — leave as completed inventory-less.
    if (order.consumedAt || order.metadata?.consumedForDate) {
      skipped += 1
      continue
    }

    const grant = grantStreakFreezeInventoryOnStore(store, order)
    const now = utcNow()
    order.status = 'completed'
    order.updatedAt = now
    order.completedAt = order.completedAt || now
    order.reviewedBy = order.reviewedBy || 'migration:streak-freeze-inventory-v1'
    order.reviewedAt = order.reviewedAt || now
    if (grant.created || grant.reason === 'already_granted') {
      migrated += 1
    }
  }

  store.events[migrationKey] = {
    eventId: migrationKey,
    done: true,
    migrated,
    skipped,
    at: utcNow(),
  }

  return { migrated, skipped, alreadyDone: false }
}

export function ensureStreakFreezeInventoryMigration(store) {
  ensureInventory(store)
  store.events = store.events || {}
  const migrationKey = 'migration:streak-freeze-inventory-v1'
  const version = Number(store.version) || 0

  // One-shot on store upgrade only — do NOT migrate new pending freezes after v5.
  if (version >= 5 && store.events[migrationKey]?.done) {
    return { migrated: 0, skipped: 0, alreadyDone: true }
  }

  if (version >= 5 && !store.events[migrationKey]?.done) {
    // Fresh v5 store (or already upgraded schema) — mark done without scanning.
    store.events[migrationKey] = {
      eventId: migrationKey,
      done: true,
      migrated: 0,
      skipped: 0,
      at: utcNow(),
    }
    return { migrated: 0, skipped: 0, alreadyDone: true }
  }

  const result = migrateLegacyStreakFreezeOrdersOnStore(store)
  store.version = Math.max(version, 5)
  return result
}
