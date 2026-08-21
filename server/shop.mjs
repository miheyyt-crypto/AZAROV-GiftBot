import crypto from 'node:crypto'

import { findProduct } from './products.mjs'
import { withStore, withStoreRead } from './store.mjs'
import { sanitizePurchaseMetadata } from './validate.mjs'
import { addCoins, spendCoins, TX_TYPE, utcNow } from './wallet.mjs'

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
    metadata: order.metadata || {},
  }
}

function requestEventKey(userId, requestId) {
  return `shop:request:${userId}:${requestId}`
}

function refundEventId(orderId) {
  return `shop:refund:${orderId}`
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

/**
 * Cancel a pending order and refund coins once.
 */
export function cancelOrder(userId, orderId) {
  return withStore((store) => {
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

    const refundId = refundEventId(order.orderId)
    const refundAmount = Number(order.price) || 0

    if (refundAmount > 0) {
      const refund = addCoins(store, user, refundAmount, TX_TYPE.REFUND, refundId, {
        referenceId: order.orderId,
        description: `Возврат: ${order.productName}`,
      })

      if (!refund.granted && refund.reason !== 'already_granted') {
        return { success: false, message: 'Не удалось вернуть монеты.' }
      }
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
  })
}
