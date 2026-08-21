import { Home, ListTodo, ShoppingBag, User, Users } from 'lucide-react'

import { ROUTES } from '@/lib/constants'
import type { NavItem } from '@/types'

export const navigationItems: NavItem[] = [
  { path: ROUTES.home, label: 'Главная', icon: Home },
  { path: ROUTES.tasks, label: 'Задания', icon: ListTodo },
  { path: ROUTES.shop, label: 'Магазин', icon: ShoppingBag },
  { path: ROUTES.friends, label: 'Друзья', icon: Users },
  { path: ROUTES.profile, label: 'Профиль', icon: User },
]
