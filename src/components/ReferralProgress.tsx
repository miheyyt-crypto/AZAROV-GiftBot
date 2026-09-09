import type { ReferralProgress as ReferralProgressType } from '@/types'

interface ReferralProgressProps extends ReferralProgressType {
  label?: string
}

export function ReferralProgress({
  current,
  required,
  label = 'Приглашено друзей',
}: ReferralProgressProps) {
  const progress = required > 0 ? Math.min((current / required) * 100, 100) : 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-[#9b96ab]">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums text-white">
          {current} / {required}
        </span>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-white/[0.08]"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={required}
        aria-label={`${label}: ${current} из ${required}`}
      >
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#9b4dff,#a855f7)] shadow-[0_0_12px_rgb(168_85_247/45%)] transition-all duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
