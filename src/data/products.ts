import cashImage from '@/assets/shop/cash.webp'
import donateImage from '@/assets/shop/donate.webp'
import freezeImage from '@/assets/shop/freeze.webp'
import musicImage from '@/assets/shop/music.webp'
import premium6mImage from '@/assets/shop/premium-6m.webp'
import premium12mImage from '@/assets/shop/premium-12m.webp'
import vipImage from '@/assets/shop/vip.webp'
import welvura200Image from '@/assets/shop/welvura-200.webp'
import type { ProductCategory, ShopProduct } from '@/types/shop'

export const shopCategories: Array<{ id: ProductCategory | 'all'; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'money', label: 'Деньги' },
  { id: 'donate', label: 'Донаты' },
  { id: 'subscription', label: 'Подписки' },
  { id: 'other', label: 'Прочее' },
]

const ADMIN_ORDERS_INFO =
  'Заявку обработает администратор — статус увидишь в «Моих заказах».'

const TELEGRAM_USERNAME_FIELD = {
  type: 'telegram_username' as const,
  label: 'Твой @username в Telegram',
  placeholder: '@username',
  hint: 'Твой @username в Telegram — на него и оформим.',
}

export const products: ShopProduct[] = [
  {
    id: 'welvura-balance-200',
    name: '200 рублей на Welvura',
    price: 5555,
    currency: 'coins',
    category: 'money',
    image: welvura200Image,
    imageClassName: 'object-contain scale-[0.92]',
    description: '200 рублей на твой баланс Welvura, с вагером х1.',
    detailText:
      '200 рублей на твой баланс Welvura, с вагером х1. Покупай товар и получай 200 рублей себе на баланс! Для получения укажи свой ID аккаунта Welvura ниже, после чего деньги уже совсем скоро прийдут тебе на баланс!',
    infoText: ADMIN_ORDERS_INFO,
    checkoutField: {
      type: 'welvura_id',
      label: 'ID аккаунта Welvura',
      placeholder: 'Например: 12345678',
      hint: 'Только цифры — ID из твоего аккаунта Welvura.',
      maxLength: 32,
    },
    available: true,
  },
  {
    id: 'cash-5000',
    name: '5 000 ₽',
    price: 199999,
    currency: 'coins',
    category: 'money',
    image: cashImage,
    imageClassName: 'object-contain scale-[0.9]',
    description: 'Выплата 5 000 ₽ на баланс Welvura.',
    detailText:
      'Выплата 5 000 ₽ на твой баланс Welvura. Укажи ID аккаунта Welvura — администратор зачислит средства после проверки. Обработка до 24 часов.',
    infoText: ADMIN_ORDERS_INFO,
    checkoutField: {
      type: 'welvura_id',
      label: 'ID аккаунта Welvura',
      placeholder: 'Например: 12345678',
      hint: 'Только цифры — ID из твоего аккаунта Welvura.',
      maxLength: 32,
    },
    available: true,
  },
  {
    id: 'stream-donate',
    name: 'Донат на стрим',
    price: 1000,
    currency: 'coins',
    category: 'donate',
    image: donateImage,
    imageClassName: 'object-contain scale-[1.15] translate-y-[5px]',
    description: 'Донат, который уйдёт на стрим.',
    detailText: 'Донат отправим на стрим после проверки заказа.',
    infoText: ADMIN_ORDERS_INFO,
    checkoutField: null,
    checkoutFields: [
      {
        type: 'donate_nickname',
        label: 'Твой ник',
        placeholder: 'Ник на стриме',
        maxLength: 20,
      },
      {
        type: 'donate_text',
        label: 'Текст доната',
        placeholder: 'Текст для озвучки на стриме',
        maxLength: 300,
      },
    ],
    available: true,
  },
  {
    id: 'stream-music',
    name: 'Заказ музыки',
    price: 4000,
    currency: 'coins',
    category: 'donate',
    image: musicImage,
    imageClassName: 'object-contain scale-[1.15] translate-y-[5px]',
    description: 'Заказ трека на стрим.',
    detailText:
      'Здесь ты можешь добавить любую музыку на стрим, просто отправь ссылку на свой трек. Принимаются ссылки с платформ YouTube и SoundCloud.',
    infoText: ADMIN_ORDERS_INFO,
    checkoutField: {
      type: 'track_url',
      label: 'Твоя ссылка на трек',
      placeholder: 'https://',
      maxLength: 500,
    },
    available: true,
  },
  {
    id: 'streak-freeze',
    name: 'Заморозка стрика',
    price: 1000,
    currency: 'coins',
    category: 'other',
    image: freezeImage,
    imageClassName: 'object-contain scale-[0.92] translate-y-[10px]',
    description: 'Сохраняет стрик, если пропущен стрим.',
    detailText:
      'Пропустил стрим — после одобрения заказа заморозка попадёт в инвентарь и сработает сама: стрик не сгорит. За тот стрим награды не будет, но и обнуления тоже. Можно держать сколько угодно штук, тратятся по одной.',
    infoText: ADMIN_ORDERS_INFO,
    checkoutField: null,
    available: true,
  },
  {
    id: 'tg-premium-6m',
    name: 'Telegram Premium 6 месяцев',
    price: 34999,
    currency: 'coins',
    category: 'subscription',
    image: premium6mImage,
    imageClassName: 'object-contain scale-[0.9]',
    description: 'Telegram Premium на 6 месяцев.',
    infoText: ADMIN_ORDERS_INFO,
    checkoutField: TELEGRAM_USERNAME_FIELD,
    available: true,
  },
  {
    id: 'tg-premium-12m',
    name: 'Telegram Premium 12 месяцев',
    price: 59999,
    currency: 'coins',
    category: 'subscription',
    image: premium12mImage,
    imageClassName: 'object-contain scale-[0.9]',
    description: 'Telegram Premium на 12 месяцев.',
    infoText: ADMIN_ORDERS_INFO,
    checkoutField: TELEGRAM_USERNAME_FIELD,
    available: true,
  },
  {
    id: 'kick-vip-forever',
    name: 'VIP в чате Kick — навсегда',
    price: 149999,
    currency: 'coins',
    category: 'other',
    image: vipImage,
    imageClassName: 'object-contain scale-[0.95] translate-y-[15px]',
    description: 'Постоянный VIP-статус в чате Kick.',
    infoText: ADMIN_ORDERS_INFO,
    checkoutField: {
      type: 'kick_username',
      label: 'Ник на Kick',
      placeholder: '@username на Kick',
      hint: 'Напиши свой ник на Kick (обязательно быть подписанным на канал)',
    },
    available: true,
  },
]

export function getProducts(): ShopProduct[] {
  return products.filter((product) => product.available).map((product) => ({ ...product }))
}

export function getProductById(productId: string): ShopProduct | null {
  return getProducts().find((product) => product.id === productId) ?? null
}

export function filterProducts(
  list: ShopProduct[],
  category: ProductCategory | 'all',
): ShopProduct[] {
  if (category === 'all') {
    return list
  }

  return list.filter((product) => product.category === category)
}
