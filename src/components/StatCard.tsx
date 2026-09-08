import { Clock, MessageCircle, type LucideIcon } from 'lucide-react'

type StatTheme = 'pink' | 'green'

interface StatCardProps {
  value: number | string
  label: string
  theme: StatTheme
  icon?: LucideIcon
}

const themes: Record<
  StatTheme,
  {
    accent: string
    iconWrap: string
    Icon: LucideIcon
  }
> = {
  pink: {
    accent: 'border-pink/25',
    iconWrap: 'bg-gradient-to-br from-[#ff7a9a] to-[#ff4d78]',
    Icon: Clock,
  },
  green: {
    accent: 'border-kick/25',
    iconWrap: 'bg-gradient-to-br from-kick-light to-kick',
    Icon: MessageCircle,
  },
}

export function StatCard({ value, label, theme, icon }: StatCardProps) {
  const styles = themes[theme]
  const Icon = icon ?? styles.Icon

  return (
    <div
      className={[
        'ui-card flex flex-1 flex-col items-center px-3 py-4 text-center',
        styles.accent,
      ].join(' ')}
    >
      <div
        className={[
          'mb-3 flex size-11 items-center justify-center rounded-[14px]',
          styles.iconWrap,
        ].join(' ')}
        aria-hidden
      >
        <Icon size={22} strokeWidth={2.4} className="text-[#101116]" />
      </div>
      <p className="text-[22px] font-bold leading-tight tracking-tight text-white">{value}</p>
      <p className="mt-1 whitespace-pre-line text-[11px] leading-snug text-muted">{label}</p>
    </div>
  )
}
