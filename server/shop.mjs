import crypto from 'node:crypto'

import { STREAK_FREEZE_PRODUCT_ID } from './constants.mjs'
import { grantStreakFreezeInventoryOnStore, publicInventoryItem } from './inventory.mjs'
import { findProduct } from './products.mjs'
import { withStore, withStoreRead } from './store.mjs'
import { assertRequiredPurchaseMetadata, sanitizePurchaseMetadata } from './validate.mjs'
import { addCoins, spendCoins, TX_TYPE, utcNow } from './wallet.mjs'
import {
  notifyOrderApprovedOnStore,
  notifyOrderRejectedOnStore,
  validateRejectionReason,
} from './notifications.mjs'

const ORDER_STATUSES = new Set([
  'pending',
  'processing',
  'completed',
  'cancelled',
  'rejected',
])

function generateOrderId(store) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const orderId = crypto.randomBytes(3).toString('hex').toUpperCase()
    if (!store.orders[orderId]) {
      return orderId
    }
  }

  return `${Date.now().toString(36).toUpperCase()}`
}

export function normalizeOrderStatus(status) {
  const value = String(status || '')
    .trim()
    .toLowerCase()
  if (ORDER_STATUSES.has(value)) {
    return value
  }

  const legacy = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    REJECTED: 'rejected',
  }
  return legacy[status] || 'pending'
}

export function isInventoryProduct(productId) {
  return String(productId) === STREAK_FREEZE_PRODUCT_ID
}

function publicOrder(order) {
  return {
    orderId: order.orderId,
    userId: order.userId,
    telegramUserId: order.userId,
    productId: order.productId,
    productName: order.productName,
    price: order.price,
    status: normalizeOrderStatus(order.status),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt || order.createdAt,
    completedAt: order.completedAt || null,
    reviewedBy: order.reviewedBy || null,
    reviewedAt: order.reviewedAt || null,
    rejectionReason: order.rejectionReason || null,
    metadata: order.metadata || {},
  }
}

function requestEventKey(userId, requestId) {
  return `shop:request:${userId}:${requestId}`
}

export function refundEventId(orderId) {
  return `shop:refund:${orderId}`
}

export function approveEventId(orderId) {
  return `shop:approve:${orderId}`
}

export function rejectEventId(orderId) {
  return `shop:reject:${orderId}`
}

function refundOrderCoins(store, order, user) {
  const refundId = refundEventId(order.orderId)
  const refundAmount = Number(order.price) || 0
  if (refundAmount <= 0) {
    return { refunded: true, reason: 'zero', already: false }
  }

  const refund = addCoins(store, user, refundAmount, TX_TYPE.REFUND, refundId, {
    referenceId: order.orderId,
    description: `Возврат: ${order.productName}`,
  })

  if (!refund.granted && refund.reason !== 'already_granted') {
    return { refunded: false, reason: refund.reason, already: false }
  }

  return {
    refunded: true,
    reason: refund.reason,
    already: refund.reason === 'already_granted',
    transaction: refund.transaction,
  }
}

export function purchaseProduct(userId, productId, requestId, metadata = {}) {
  return withStore((store) => {
    const user = store.users[String(userId)]
    store.orders = store.orders || {}

    if (!user) {
      return { success: false, message: 'Пользователь не найден.' }
    }

    // Catalog is server-side only — ignore any client price/amount.
    const product = findProduct(productId)
    if (!product || product.available === false) {
      return { success: false, message: 'Товар не найден.' }
    }

    const price = Number(product.price)
    if (!Number.isInteger(price) || price <= 0) {
      return { success: false, message: 'Товар временно недоступен.' }
    }

    const idempotencyKey = String(requestId || '').trim()
    if (!idempotencyKey) {
      return {
        success: false,
        code: 'MISSING_REQUEST_ID',
        message: 'Нужен requestId для этой операции.',
      }
    }

    const existingEvent = store.events[requestEventKey(userId, idempotencyKey)]
    if (existingEvent?.orderId && store.orders[existingEvent.orderId]) {
      const existingOrder = store.orders[existingEvent.orderId]
      if (Number(existingOrder.userId) === Number(userId)) {
        return {
          success: true,
          message: 'Заказ уже оформлен.',
          order: publicOrder(existingOrder),
          created: false,
        }
      }
    }

    const balance = Number(user.balance || 0)
    if (balance < price) {
      return {
        success: false,
        code: 'INSUFFICIENT_FUNDS',
        message: `Для покупки нужно ${price.toLocaleString('ru-RU')} 🪙, а у тебя только ${balance.toLocaleString('ru-RU')} 🪙.`,
      }
    }

    const safeMetadata = sanitizePurchaseMetadata(metadata)
    const required = assertRequiredPurchaseMetadata(product, safeMetadata)
    if (!required.ok) {
      return {
        success: false,
        code: required.code,
        message: required.message,
      }
    }
    user.orderIds = user.orderIds || []
    const orderId = generateOrderId(store)
    const createdAt = utcNow()

    // Spend + order creation inside one withStore transaction.
    const spend = spendCoins(store, user, price, TX_TYPE.SHOP_PURCHASE, `shop:order:${orderId}`, {
      referenceId: orderId,
      description: `Покупка: ${product.name}`,
    })

    if (!spend.spent) {
      return {
        success: false,
        code: spend.reason === 'insufficient' ? 'INSUFFICIENT_FUNDS' : 'ALREADY_PROCESSED',
        message:
          spend.reason === 'insufficient'
            ? `Для покупки нужно ${price.toLocaleString('ru-RU')} 🪙, а у тебя только ${Number(user.balance || 0).toLocaleString('ru-RU')} 🪙.`
            : 'Покупка уже обрабатывается.',
      }
    }

    const order = {
      orderId,
      userId: Number(userId),
      productId: product.id,
      productName: product.name,
      price,
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
      refundedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      metadata: safeMetadata,
    }

    store.orders[orderId] = order
    user.orderIds = [...user.orderIds, orderId]

    store.events[requestEventKey(userId, idempotencyKey)] = {
      eventId: requestEventKey(userId, idempotencyKey),
      userId,
      amount: 0,
      reason: TX_TYPE.SHOP_PURCHASE,
      orderId,
      createdAt,
    }

    return {
      success: true,
      message: 'Заказ создан и ожидает выполнения.',
      order: publicOrder(order),
      created: true,
    }
  })
}

export function getUserOrders(userId) {
  return withStoreRead((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return { success: false, message: 'Пользователь не найден.', orders: [] }
    }

    const orders = (user.orderIds || [])
      .map((orderId) => store.orders?.[orderId])
      .filter((order) => order && Number(order.userId) === Number(userId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(publicOrder)

    return { success: true, orders }
  })
}

export function getOrder(userId, orderId) {
  return withStoreRead((store) => {
    const order = store.orders?.[orderId]
    if (!order || Number(order.userId) !== Number(userId)) {
      return { success: false, message: 'Заказ не найден.' }
    }

    return { success: true, order: publicOrder(order) }
  })
}

export function listShopOrdersForAdmin(statusFilter = '') {
  return withStoreRead((store) => {
    store.orders = store.orders || {}
    let orders = Object.values(store.orders)
    const filter = String(statusFilter || '')
      .trim()
      .toLowerCase()
    if (filter && ORDER_STATUSES.has(filter)) {
      orders = orders.filter((order) => normalizeOrderStatus(order.status) === filter)
    }
    orders = orders
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(publicOrder)
    return { success: true, orders }
  })
}

/**
 * Cancel a pending order and refund coins once.
 */
export function cancelOrder(userId, orderId) {
  return withStore((store) => cancelOrderOnStore(store, userId, orderId))
}

export function cancelOrderOnStore(store, userId, orderId) {
  const order = store.orders?.[orderId]
  if (!order || Number(order.userId) !== Number(userId)) {
    return { success: false, message: 'Заказ не найден.' }
  }

  const status = normalizeOrderStatus(order.status)
  if (status === 'cancelled') {
    return {
      success: true,
      message: 'Заказ уже отменён.',
      order: publicOrder(order),
    }
  }

  if (status !== 'pending') {
    return { success: false, message: 'Этот заказ уже нельзя отменить.' }
  }

  const user = store.users[String(userId)]
  if (!user) {
    return { success: false, message: 'Пользователь не найден.' }
  }

  const refund = refundOrderCoins(store, order, user)
  if (!refund.refunded) {
    return { success: false, message: 'Не удалось вернуть монеты.' }
  }

  const now = utcNow()
  order.status = 'cancelled'
  order.updatedAt = now
  order.refundedAt = order.refundedAt || now

  return {
    success: true,
    message: 'Заказ отменён, монеты возвращены.',
    order: publicOrder(order),
  }
}

/**
 * Admin approve — idempotent via shop:approve:{orderId}.
 * Inventory products get exactly one inventory item; manual products only complete.
 */
export function approveShopOrderOnStore(store, orderId, reviewedBy, requestId = '') {
  store.orders = store.orders || {}
  store.events = store.events || {}
  const order = store.orders[orderId]
  if (!order) {
    return { success: false, message: 'Заказ не найден.' }
  }

  const approveKey = approveEventId(order.orderId)
  const status = normalizeOrderStatus(order.status)

  if (status === 'completed') {
    const inventoryItem = isInventoryProduct(order.productId)
      ? grantStreakFreezeInventoryOnStore(store, order).item
      : null
    if (!store.events[approveKey]?.done) {
      store.events[approveKey] = {
        eventId: approveKey,
        done: true,
        orderId: order.orderId,
        reviewedBy: order.reviewedBy || String(reviewedBy || 'admin'),
        requestId: requestId || null,
        createdAt: order.reviewedAt || utcNow(),
      }
    }
    notifyOrderApprovedOnStore(store, order)
    return {
      success: true,
      message: 'Заказ уже одобрен.',
      order: publicOrder(order),
      inventoryItem: publicInventoryItem(inventoryItem),
      alreadyProcessed: true,
    }
  }

  if (status === 'cancelled') {
    return { success: false, message: 'Заказ отменён пользователем — одобрить нельзя.' }
  }

  if (status === 'rejected') {
    return { success: false, message: 'Заказ уже отклонён.' }
  }

  if (status !== 'pending' && status !== 'processing') {
    return { success: false, message: 'Этот заказ нельзя одобрить.' }
  }

  const now = utcNow()
  let inventoryItem = null

  if (isInventoryProduct(order.productId)) {
    const grant = grantStreakFreezeInventoryOnStore(store, order)
    inventoryItem = grant.item
  }

  order.status = 'completed'
  order.updatedAt = now
  order.completedAt = order.completedAt || now
  order.reviewedBy = String(reviewedBy || 'admin')
  order.reviewedAt = now
  order.rejectionReason = null

  const reqKey = requestId ? `shop:approve:${order.orderId}:${requestId}` : null
  store.events[approveKey] = {
    eventId: approveKey,
    done: true,
    orderId: order.orderId,
    reviewedBy: order.reviewedBy,
    requestId: requestId || null,
    createdAt: now,
  }
  if (reqKey) {
    store.events[reqKey] = store.events[approveKey]
  }

  notifyOrderApprovedOnStore(store, order)

  return {
    success: true,
    message: isInventoryProduct(order.productId)
      ? 'Заказ одобрен — заморозка добавлена в инвентарь.'
      : 'Заказ одобрен.',
    order: publicOrder(order),
    inventoryItem: publicInventoryItem(inventoryItem),
    alreadyProcessed: false,
  }
}

export function approveShopOrder(orderId, reviewedBy, requestId = '') {
  return withStore((store) => approveShopOrderOnStore(store, orderId, reviewedBy, requestId))
}

/**
 * Admin reject — idempotent refund via shop:refund:{orderId}.
 */
export function rejectShopOrderOnStore(store, orderId, reviewedBy, rejectionReason = '', requestId = '') {
  store.orders = store.orders || {}
  store.events = store.events || {}
  const order = store.orders[orderId]
  if (!order) {
    return { success: false, message: 'Заказ не найден.' }
  }

  const rejectKey = rejectEventId(order.orderId)
  const status = normalizeOrderStatus(order.status)

  if (status === 'rejected' && (store.events[rejectKey]?.done || order.refundedAt)) {
    notifyOrderRejectedOnStore(store, order)
    return {
      success: true,
      message: 'Заказ уже отклонён.',
      order: publicOrder(order),
      alreadyProcessed: true,
    }
  }

  if (status === 'cancelled') {
    return { success: false, message: 'Заказ уже отменён пользователем.' }
  }

  if (status === 'completed') {
    return { success: false, message: 'Заказ уже выполнен — отклонить нельзя.' }
  }

  if (status !== 'pending' && status !== 'processing') {
    return { success: false, message: 'Этот заказ нельзя отклонить.' }
  }

  const reasonCheck = validateRejectionReason(rejectionReason)
  if (!reasonCheck.ok) {
    return {
      success: false,
      code: reasonCheck.code,
      message: reasonCheck.message,
    }
  }

  const user = store.users[String(order.userId)]
  if (!user) {
    return { success: false, message: 'Пользователь не найден.' }
  }

  const refund = refundOrderCoins(store, order, user)
  if (!refund.refunded) {
    return { success: false, message: 'Не удалось вернуть монеты.' }
  }

  const now = utcNow()

  order.status = 'rejected'
  order.updatedAt = now
  order.reviewedBy = String(reviewedBy || 'admin')
  order.reviewedAt = now
  order.rejectionReason = reasonCheck.value
  order.refundedAt = order.refundedAt || now

  const reqKey = requestId ? `shop:reject:${order.orderId}:${requestId}` : null
  store.events[rejectKey] = {
    eventId: rejectKey,
    done: true,
    orderId: order.orderId,
    reviewedBy: order.reviewedBy,
    requestId: requestId || null,
    createdAt: now,
  }
  if (reqKey) {
    store.events[reqKey] = store.events[rejectKey]
  }

  notifyOrderRejectedOnStore(store, order)

  return {
    success: true,
    message: 'Заказ отклонён, монеты возвращены.',
    order: publicOrder(order),
    alreadyProcessed: false,
  }
}

export function rejectShopOrder(orderId, reviewedBy, rejectionReason = '', requestId = '') {
  return withStore((store) =>
    rejectShopOrderOnStore(store, orderId, reviewedBy, rejectionReason, requestId),
  )
}
