import type { TelegramUser } from '@/types'
import { getUserInitial } from '@/lib/user'

const sizeClasses = {
  sm: 'size-10 text-sm',
  md: 'size-[72px] text-2xl',
  lg: 'size-[100px] text-3xl',
} as const

interface UserAvatarProps {
  user: TelegramUser
  size?: 'sm' | 'md' | 'lg'
}

export function UserAvatar({ user, size = 'lg' }: UserAvatarProps) {
  const initial = getUserInitial(user)

  if (user.photo_url) {
    return (
      <div
        className={[
          'relative shrink-0 overflow-hidden rounded-full',
          'border-2 border-neon-purple/80',
          'shadow-[var(--glow-purple)]',
          sizeClasses[size],
        ].join(' ')}
      >
        <img
          src={user.photo_url}
          alt={user.first_name}
          className="size-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={[
        'relative flex shrink-0 items-center justify-center rounded-full',
        'border-2 border-neon-purple/80 bg-gradient-to-br from-purple to-neon-purple',
        'font-bold text-white shadow-[var(--glow-purple)]',
        sizeClasses[size],
      ].join(' ')}
      aria-label={`Аватар ${user.first_name}`}
    >
      {initial}
    </div>
  )
}
