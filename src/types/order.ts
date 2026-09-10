import type { Currency } from '@/types/operation'

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'refunded'

export interface Order {
  id: string
  userId: number
  productId: string
  productName: string
  productImage: string
  quantity: number
  price: number
  currency: Currency
  status: OrderStatus
  comment?: string
  info?: string
  telegramUsername?: string
  usdtAddress?: string
  kickUsername?: string
  donateNickname?: string
  donateText?: string
  trackUrl?: string
  welvuraId?: string
  createdAt: string
  updatedAt: string
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Ожидает обработки',
  processing: 'В работе',
  completed: 'Выполнен',
  cancelled: 'Отменён',
  rejected: 'Отклонён',
  refunded: 'Возвращён',
}

export const ORDER_STATUS_EMOJI: Record<OrderStatus, string> = {
  pending: '🟡',
  processing: '🔵',
  completed: '🟢',
  cancelled: '⚪️',
  rejected: '🔴',
  refunded: '♻️',
}
