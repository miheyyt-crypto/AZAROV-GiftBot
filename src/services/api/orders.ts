import { getProductById } from '@/data/products'
import { getUserOrders as getRemoteShopOrders } from '@/lib/shop'
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
      return 'rejected'
    default:
      return 'pending'
  }
}

export function mapShopOrderToOrder(order: ShopOrder): Order {
  const product = getProductById(order.productId)
  const rejectionReason =
    typeof order.rejectionReason === 'string' && order.rejectionReason.trim()
      ? order.rejectionReason.trim()
      : undefined

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
    donateNickname: order.metadata?.donateNickname,
    donateText: order.metadata?.donateText,
    trackUrl: order.metadata?.trackUrl,
    welvuraId: order.metadata?.welvuraId,
    rejectionReason,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt ?? order.completedAt ?? order.createdAt,
  }
}

/**
 * Orders API layer — backend only. Empty list is empty; failures throw.
 */
export async function getOrders(): Promise<Order[]> {
  const remote = await getRemoteShopOrders()
  return remote
    .map(mapShopOrderToOrder)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const orders = await getOrders()
  return orders.find((item) => item.id === orderId) ?? null
}
