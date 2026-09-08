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
    card: string
    iconWrap: string
    Icon: LucideIcon
  }
> = {
  pink: {
    card: 'border-[#ff6b8a]/35 bg-[radial-gradient(ellipse_at_center,rgb(255_80_120/12%),rgb(18_16_24/90%)_70%)] shadow-[0_0_18px_rgb(255_80_120/14%)]',
    iconWrap:
      'bg-gradient-to-br from-[#ff7a9a] to-[#ff4d78] shadow-[0_0_16px_rgb(255_77_120/45%)]',
    Icon: Clock,
  },
  green: {
    card: 'border-[#53cc18]/35 bg-[radial-gradient(ellipse_at_center,rgb(83_204_24/12%),rgb(18_16_24/90%)_70%)] shadow-[0_0_18px_rgb(83_204_24/14%)]',
    iconWrap:
      'bg-gradient-to-br from-[#7ae045] to-[#53cc18] shadow-[0_0_16px_rgb(83_204_24/45%)]',
    Icon: MessageCircle,
  },
}

export function StatCard({ value, label, theme, icon }: StatCardProps) {
  const styles = themes[theme]
  const Icon = icon ?? styles.Icon

  return (
    <div
      className={[
        'flex flex-1 flex-col items-center rounded-[20px] border px-3 py-4 text-center',
        styles.card,
      ].join(' ')}
    >
      <div
        className={[
          'mb-3 flex size-11 items-center justify-center rounded-[14px]',
          styles.iconWrap,
        ].join(' ')}
        aria-hidden
      >
        <Icon size={22} strokeWidth={2.6} className="text-[#101116]" />
      </div>
      <p className="text-[22px] font-bold leading-tight text-white">{value}</p>
      <p className="mt-1 whitespace-pre-line text-[11px] leading-snug text-muted">
        {label}
      </p>
    </div>
  )
}
