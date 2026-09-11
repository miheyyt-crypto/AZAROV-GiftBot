import {
  Award,
  Bell,
  ChevronRight,
  Headset,
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
  {
    id: 'support',
    label: 'Тех. поддержка',
    icon: Headset,
    iconClass: 'bg-emerald-500/20 text-emerald-300',
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
    <nav className="ui-card overflow-hidden">
      {menuItems.map((item, index) => {
        const Icon = item.icon
        const showBadge = item.id === 'notifications' && unreadNotifications > 0

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={[
              'flex min-h-14 w-full items-center gap-4 px-4 py-3.5 text-left active:bg-white/[0.04]',
              index > 0 ? 'border-t border-white/[0.06]' : '',
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
            <span className="flex flex-1 items-center gap-2 text-[15px] font-medium text-white">
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
