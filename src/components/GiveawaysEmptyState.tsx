import { Gift } from 'lucide-react'

interface GiveawaysEmptyStateProps {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

export function GiveawaysEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: GiveawaysEmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div
        className="mb-4 flex size-[72px] items-center justify-center rounded-2xl border border-kick/20 bg-kick/10"
        aria-hidden
      >
        <Gift size={34} strokeWidth={1.75} className="text-kick" />
      </div>

      <h3 className="text-[17px] font-bold tracking-tight text-white">{title}</h3>
      <p className="mt-2 max-w-[240px] text-[13px] leading-relaxed text-muted">{description}</p>

      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-6 min-h-11 rounded-2xl border border-white/15 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white transition-[filter,background-color] hover:bg-white/[0.07] active:brightness-95"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
