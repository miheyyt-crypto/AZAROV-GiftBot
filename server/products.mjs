export const PRODUCTS = [
  { id: 'welvura-balance-200', name: '200 рублей на Welvura', price: 5555, available: true, requireWelvuraId: true },
  { id: 'welvura-balance-500', name: '500 рублей на Welvura', price: 5555, available: true, requireWelvuraId: true },
  { id: 'cash-5000', name: '5 000 ₽', price: 199999, available: true, requireWelvuraId: true },
  { id: 'stream-donate', name: 'Донат на стрим', price: 1000, available: true },
  { id: 'stream-music', name: 'Заказ музыки', price: 4000, available: true },
  { id: 'streak-freeze', name: 'Заморозка стрика', price: 1000, available: true },
  { id: 'tg-premium-6m', name: 'Telegram Premium 6 месяцев', price: 34999, available: true },
  { id: 'tg-premium-12m', name: 'Telegram Premium 12 месяцев', price: 59999, available: true },
  { id: 'kick-vip-forever', name: 'VIP в чате Kick — навсегда', price: 149999, available: true },
]

export function findProduct(productId) {
  return PRODUCTS.find((product) => product.id === productId && product.available) || null
}
