import { getProductById } from '@/data/products'
import { delay } from '@/lib/format'
import { getUserOrders as getRemoteShopOrders } from '@/lib/shop'
import { MOCK_ORDERS } from '@/mockData/orders'
import type { Order, OrderStatus } from '@/types/order'
import type { ShopOrder } from '@/types/shop'

function mapLegacyStatus(status: ShopOrder['status']): OrderStatus {
  switch (String(status).toLowerCase()) {
    case 'pending':
      return 'pending'
    case 'processing':
      return 'processing'
    case 'completed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    case 'rejected':
      return 'cancelled'
    default:
      return 'pending'
  }
}

export function mapShopOrderToOrder(order: ShopOrder): Order {
  const product = getProductById(order.productId)

  return {
    id: order.orderId,
    userId: order.userId,
    productId: order.productId,
    productName: order.productName,
    productImage: product?.image ?? '',
    quantity: 1,
    price: order.price,
    currency: 'COINS',
    status: mapLegacyStatus(order.status),
    comment: order.metadata?.comment,
    info: order.metadata?.info,
    telegramUsername: order.metadata?.telegramUsername,
    usdtAddress: order.metadata?.usdtAddress,
    kickUsername: order.metadata?.kickUsername,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt ?? order.completedAt ?? order.createdAt,
  }
}

/**
 * Orders API layer.
 * Tries existing shop endpoint when available; falls back to mock for UI demo.
 * Replace with real backend fetch later — UI should keep using these functions.
 */
export async function getOrders(): Promise<Order[]> {
  try {
    const remote = await getRemoteShopOrders()
    if (remote.length > 0) {
      return remote.map(mapShopOrderToOrder)
    }
  } catch {
    // Fall through to mock demo data.
  }

  await delay(450)
  return [...MOCK_ORDERS].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const orders = await getOrders()
  return orders.find((item) => item.id === orderId) ?? null
}

/**
 * Frontend stub for future backend `POST /orders`.
 * Does not mutate balance or invent business rules — returns a local preview shape only.
 */
export async function createOrderDraft(input: {
  productId: string
  productName: string
  productImage: string
  price: number
  quantity?: number
  userId?: number
}): Promise<Order> {
  await delay(200)
  const now = new Date().toISOString()

  return {
    id: `draft-${Date.now()}`,
    userId: input.userId ?? 0,
    productId: input.productId,
    productName: input.productName,
    productImage: input.productImage,
    quantity: input.quantity ?? 1,
    price: input.price,
    currency: 'COINS',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }
}
