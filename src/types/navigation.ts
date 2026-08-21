import type { LucideIcon } from 'lucide-react'

export type AppRoute = '/' | '/tasks' | '/shop' | '/friends' | '/profile'

export interface NavItem {
  path: AppRoute
  label: string
  icon: LucideIcon
}
