import { applyAccountSnapshot } from '@/lib/account'
import {
  cancelOrderRequest,
  getOrderRequest,
  getUserOrdersRequest,
  purchaseProductRequest,
} from '@/lib/api'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import { mapRemoteAccount } from '@/lib/session'
import type { PurchaseFulfillmentData, ShopOrder } from '@/types/shop'

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает выполнения',
  processing: 'Выполняется',
  completed: 'Выполнено',
  cancelled: 'Отменено',
  rejected: 'Отклонён',
  PENDING: 'Ожидает выполнения',
  PROCESSING: 'Выполняется',
  COMPLETED: 'Выполнено',
  CANCELLED: 'Отменено',
  REJECTED: 'Отклонён',
}

export const ORDER_STATUS_HINTS: Record<string, string> = {
  pending: 'Заказ получен и ожидает выполнения.',
  processing: 'Заказ находится в обработке.',
  completed: 'Заказ успешно выполнен.',
  cancelled: 'Заказ отменён, монеты возвращены.',
  rejected: 'Заказ отклонён, монеты возвращены.',
  PENDING: 'Заказ получен и ожидает выполнения.',
  PROCESSING: 'Заказ находится в обработке.',
  COMPLETED: 'Заказ успешно выполнен.',
  CANCELLED: 'Заказ отменён, монеты возвращены.',
  REJECTED: 'Заказ отклонён, монеты возвращены.',
}

function applyRemoteUser(user: Parameters<typeof mapRemoteAccount>[0] | undefined): void {
  if (!user) {
    return
  }

  applyAccountSnapshot(mapRemoteAccount(user))
  hydrateBalanceFromAccount()
}

export function formatOrderDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString('ru-RU')
}

export async function purchaseProduct(
  productId: string,
  requestId: string,
  fulfillment: PurchaseFulfillmentData = {},
): Promise<{ success: boolean; message?: string; code?: string; order?: ShopOrder }> {
  const metadata: Record<string, string> = {}
  if (fulfillment.telegramUsername) {
    metadata.telegramUsername = fulfillment.telegramUsername
  }
  if (fulfillment.usdtAddress) {
    metadata.usdtAddress = fulfillment.usdtAddress
  }
  if (fulfillment.kickUsername) {
    metadata.kickUsername = fulfillment.kickUsername
  }
  if (fulfillment.donateNickname) {
    metadata.donateNickname = fulfillment.donateNickname
  }
  if (fulfillment.donateText) {
    metadata.donateText = fulfillment.donateText
  }

  try {
    const result = await purchaseProductRequest(productId, requestId, metadata)
    applyRemoteUser(result.user)
    return {
      success: Boolean(result.success),
      message: result.message,
      code: result.code,
      order: result.order,
    }
  } catch {
    return {
      success: false,
      message: 'Не удалось оформить покупку. Попробуй ещё раз.',
    }
  }
}

export async function getUserOrders(): Promise<ShopOrder[]> {
  try {
    const result = await getUserOrdersRequest()
    applyRemoteUser(result.user)
    return result.orders ?? []
  } catch {
    return []
  }
}

export async function getOrder(orderId: string): Promise<ShopOrder | null> {
  try {
    const result = await getOrderRequest(orderId)
    applyRemoteUser(result.user)
    return result.order ?? null
  } catch {
    return null
  }
}

export async function cancelOrder(orderId: string): Promise<{ success: boolean; message?: string; order?: ShopOrder }> {
  try {
    const result = await cancelOrderRequest(orderId)
    applyRemoteUser(result.user)
    return {
      success: Boolean(result.success),
      message: result.message,
      order: result.order,
    }
  } catch {
    return {
      success: false,
      message: 'Не удалось отменить заказ. Попробуй ещё раз.',
    }
  }
}

export function createPurchaseRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
