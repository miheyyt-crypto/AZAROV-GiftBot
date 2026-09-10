import bannerFriends from '@/assets/banners/banner-friends.webp'
import bannerShop from '@/assets/banners/banner-shop.webp'
import bannerTasks from '@/assets/banners/banner-tasks.webp'
import { ROUTES } from '@/lib/constants'
import type { HomeBanner } from '@/types/banner'

export const homeBanners: HomeBanner[] = [
  {
    id: 'banner-tasks',
    image: bannerTasks,
    targetTab: ROUTES.tasks,
  },
  {
    id: 'banner-shop',
    image: bannerShop,
    targetTab: ROUTES.shop,
  },
  {
    id: 'banner-friends',
    image: bannerFriends,
    targetTab: ROUTES.friends,
  },
]

export function getHomeBanners(): HomeBanner[] {
  return homeBanners.map((banner) => ({ ...banner }))
}
