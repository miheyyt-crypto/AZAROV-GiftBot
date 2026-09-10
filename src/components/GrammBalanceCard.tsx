import gramImage from '@/assets/cases/reward-gram.webp'
import { formatGrammLabel } from '@/lib/gramm'

type GrammBalanceCardProps = {
  balance: number
  onOpen: () => void
  className?: string
}

export function GrammBalanceCard({ balance, onOpen, className = '' }: GrammBalanceCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        'w-full rounded-[22px] border border-white/10 bg-[#17151f] p-4 text-left',
        'shadow-[0_8px_24px_rgb(0_0_0/28%)] transition active:scale-[0.99]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`Gramm: ${formatGrammLabel(balance)}. Нажмите, чтобы открыть`}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#0b1a2a]"
          aria-hidden
        >
          <img src={gramImage} alt="" className="size-9 object-contain" draggable={false} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-[#b8b4c4]">Gramm</p>
          <p className="mt-1 text-[22px] font-bold leading-none tracking-tight text-white tabular-nums">
            {formatGrammLabel(balance)}
          </p>
          <p className="mt-2 text-[12px] text-white/45">Нажмите, чтобы открыть</p>
        </div>
      </div>
    </button>
  )
}
