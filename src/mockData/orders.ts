import freezeImage from '@/assets/shop/freeze.svg'
import premium6mImage from '@/assets/shop/premium-6m.png'
import diamondImage from '@/assets/shop/diamond.png'
import donateImage from '@/assets/shop/donate.png'
import type { Order } from '@/types/order'

const now = Date.now()
const hour = 60 * 60 * 1000
const day = 24 * hour

export const MOCK_ORDERS: Order[] = [
  {
    id: '1024',
    userId: 1,
    productId: 'tg-premium-6m',
    productName: 'Telegram Premium 6 месяцев',
    productImage: premium6mImage,
    quantity: 1,
    price: 34999,
    currency: 'COINS',
    status: 'processing',
    comment: 'Ожидай выдачу подарка после проверки.',
    info: 'После выполнения статус изменится на «Выполнен».',
    createdAt: new Date(now - 2 * hour).toISOString(),
    updatedAt: new Date(now - hour).toISOString(),
  },
  {
    id: '1023',
    userId: 1,
    productId: 'diamond-autograph',
    productName: 'Подарок Алмаз Роспись',
    productImage: diamondImage,
    quantity: 1,
    price: 3333,
    currency: 'COINS',
    status: 'pending',
    createdAt: new Date(now - day).toISOString(),
    updatedAt: new Date(now - day).toISOString(),
  },
  {
    id: '1020',
    userId: 1,
    productId: 'stream-donate',
    productName: 'Донат на стрим',
    productImage: donateImage,
    quantity: 1,
    price: 2499,
    currency: 'COINS',
    status: 'completed',
    info: 'Донат отправлен на стрим.',
    createdAt: new Date(now - 3 * day).toISOString(),
    updatedAt: new Date(now - 3 * day + 2 * hour).toISOString(),
  },
  {
    id: '1018',
    userId: 1,
    productId: 'streak-freeze',
    productName: 'Заморозка стрика',
    productImage: freezeImage,
    quantity: 1,
    price: 1000,
    currency: 'COINS',
    status: 'refunded',
    comment: 'Средства возвращены на баланс.',
    createdAt: new Date(now - 5 * day).toISOString(),
    updatedAt: new Date(now - 4 * day).toISOString(),
  },
]
