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
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#a1a1aa]">{label}</span>
        <span className="font-medium text-white">
          {current} / {required}
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={required}
        aria-label={`${label}: ${current} из ${required}`}
      >
        <div
          className="h-full rounded-full bg-[#9d59ff] transition-all duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
