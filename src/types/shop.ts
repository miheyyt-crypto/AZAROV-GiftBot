export type ProductCategory = 'money' | 'donate' | 'subscription' | 'other'

export type ShopSection = 'shop' | 'cases'

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  // Legacy uppercase values may still appear briefly during migration.
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED'

export type ProductFulfillmentField =
  | 'telegram_username'
  | 'usdt_trc20'
  | 'kick_username'
  | 'donate_nickname'
  | 'donate_text'

export interface ProductCheckoutField {
  type: ProductFulfillmentField
  label: string
  placeholder: string
  hint?: string
  maxLength?: number
}

export interface ShopProduct {
  id: string
  name: string
  price: number
  currency: 'coins'
  category: ProductCategory
  image: string
  /** Extra classes for the product image (e.g. scale). */
  imageClassName?: string
  /** Short text used in lists / fallback. */
  description: string
  /** Longer body text under the price on the checkout sheet. */
  detailText?: string
  /** Info tip block under price / detail. */
  infoText: string
  /** Optional user data field required before purchase. */
  checkoutField?: ProductCheckoutField | null
  /** Multiple checkout fields (e.g. stream donate nickname + message). */
  checkoutFields?: ProductCheckoutField[]
  available: boolean
}

export interface ShopOrder {
  orderId: string
  userId: number
  productId: string
  productName: string
  price: number
  status: OrderStatus
  createdAt: string
  updatedAt?: string
  completedAt?: string | null
  metadata?: Record<string, string>
}

export interface PurchaseFulfillmentData {
  telegramUsername?: string
  usdtAddress?: string
  kickUsername?: string
  donateNickname?: string
  donateText?: string
}
