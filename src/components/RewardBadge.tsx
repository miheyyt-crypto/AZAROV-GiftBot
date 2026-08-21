interface RewardBadgeProps {
  reward: number
  suffix?: string
  prefix?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
  lg: 'px-3 py-1.5 text-base',
} as const

export function RewardBadge({
  reward,
  suffix = '',
  prefix = 'ОТ',
  size = 'md',
  className = '',
}: RewardBadgeProps) {
  const formatted = new Intl.NumberFormat('ru-RU').format(reward)
  const prefixLabel = prefix.toLowerCase() === 'от' ? 'от' : prefix

  return (
    <div
      className={[
        'inline-flex flex-col items-end gap-0.5',
        className,
      ].join(' ')}
    >
      {prefix && (
        <span className="text-[10px] font-medium text-white/55">{prefixLabel}</span>
      )}
      <span
        className={[
          'inline-flex items-center gap-1 rounded-xl border border-white/10',
          'bg-black/35 font-bold text-white backdrop-blur-sm',
          sizeClasses[size],
        ].join(' ')}
      >
        <span aria-hidden>🪙</span>
        {formatted}
        {suffix}
      </span>
    </div>
  )
}
