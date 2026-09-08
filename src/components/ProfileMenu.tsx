import {
  Award,
  Bell,
  ChevronRight,
  History,
  LogOut,
  Package,
  Receipt,
  Store,
} from 'lucide-react'

import type { ProfileMenuId } from '@/types/profile'

interface ProfileMenuProps {
  onSelect: (id: ProfileMenuId) => void
  showLogout?: boolean
  unreadNotifications?: number
}

const items: Array<{
  id: Exclude<ProfileMenuId, 'logout'>
  label: string
  icon: typeof History
  iconClass: string
}> = [
  {
    id: 'notifications',
    label: 'Уведомления',
    icon: Bell,
    iconClass: 'bg-amber-500/20 text-amber-300',
  },
  {
    id: 'coin-history',
    label: 'История монет',
    icon: History,
    iconClass: 'bg-[#f5c842]/20 text-[#f5c842]',
  },
  {
    id: 'operations',
    label: 'История операций',
    icon: Receipt,
    iconClass: 'bg-neon-purple/20 text-neon-purple',
  },
  {
    id: 'inventory',
    label: 'Инвентарь',
    icon: Package,
    iconClass: 'bg-sky-500/20 text-sky-300',
  },
  {
    id: 'orders',
    label: 'Мои заказы',
    icon: Store,
    iconClass: 'bg-pink-500/20 text-pink-400',
  },
  {
    id: 'achievements',
    label: 'Достижения',
    icon: Award,
    iconClass: 'bg-fuchsia-500/20 text-fuchsia-400',
  },
]

export function ProfileMenu({
  onSelect,
  showLogout = false,
  unreadNotifications = 0,
}: ProfileMenuProps) {
  const menuItems: Array<{
    id: ProfileMenuId
    label: string
    icon: typeof History
    iconClass: string
  }> = showLogout
    ? [
        ...items,
        {
          id: 'logout',
          label: 'Выйти',
          icon: LogOut,
          iconClass: 'bg-white/10 text-muted',
        },
      ]
    : items

  return (
    <nav className="overflow-visible rounded-[22px] border border-white/10 bg-white/[0.03] backdrop-blur-md">
      {menuItems.map((item, index) => {
        const Icon = item.icon
        const showBadge = item.id === 'notifications' && unreadNotifications > 0

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={[
              'flex w-full items-center gap-4 px-4 py-4 text-left active:bg-white/[0.04]',
              index > 0 ? 'border-t border-white/5' : '',
              index === 0 ? 'rounded-t-[21px]' : '',
              index === menuItems.length - 1 ? 'rounded-b-[21px]' : '',
            ].join(' ')}
          >
            <span
              className={[
                'flex size-11 shrink-0 items-center justify-center rounded-xl',
                item.iconClass,
              ].join(' ')}
            >
              <Icon size={20} aria-hidden />
            </span>
            <span className="flex flex-1 items-center gap-2 text-base font-medium text-white">
              {item.label}
              {showBadge ? (
                <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-black">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              ) : null}
            </span>
            <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
          </button>
        )
      })}
    </nav>
  )
}
