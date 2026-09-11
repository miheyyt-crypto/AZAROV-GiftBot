import { ChevronRight } from 'lucide-react'

import referralImage from '@/assets/cases/referral.webp'

interface ReferralCaseBannerProps {
  onClick: () => void
}

export function ReferralCaseBanner({ onClick }: ReferralCaseBannerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-3.5 rounded-[24px] border border-[#b56bff]/55',
        'bg-[#14101c] px-3.5 py-3 text-left',
        'shadow-[0_0_24px_rgb(181_107_255/22%),0_8px_20px_rgb(0_0_0/30%)]',
        'active:scale-[0.99] transition-transform',
      ].join(' ')}
      aria-label="Реферальный кейс"
    >
      <span className="relative flex size-[58px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#0c0a12]">
        <img
          src={referralImage}
          alt=""
          className="size-full object-cover object-center scale-[1.15]"
          draggable={false}
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-bold leading-tight tracking-tight text-white">
          Реферальный кейс
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[#9b96ab]">
          Внутри — до 3 000 ₽
        </span>
      </span>

      <ChevronRight size={20} className="shrink-0 text-[#6f6a80]" aria-hidden />
    </button>
  )
}
