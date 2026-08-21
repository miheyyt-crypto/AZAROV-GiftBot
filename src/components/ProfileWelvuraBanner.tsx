import { ChevronRight } from 'lucide-react'

import welvuraCookie from '@/assets/partners/welvura-cookie.png'

interface ProfileWelvuraBannerProps {
  onClick: () => void
}

export function ProfileWelvuraBanner({ onClick }: ProfileWelvuraBannerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-full overflow-hidden rounded-[22px] border border-[#c47a3a]/40 bg-gradient-to-r from-[#6b3a16] via-[#3a2012] to-[#151018] p-5 text-left shadow-[0_0_32px_rgb(196_122_58/22%)]"
    >
      <div className="relative z-10 max-w-[58%]">
        <h3 className="text-2xl font-bold text-white">Welvura</h3>
        <p className="mt-2 text-sm leading-snug text-white/80">
          Привязывай аккаунт, выполняй задания и получай монеты за депозиты
        </p>
        <span className="mt-4 inline-flex items-center gap-1 rounded-xl bg-[#c47a3a] px-4 py-2 text-sm font-semibold text-white">
          Привязать
          <ChevronRight size={16} aria-hidden />
        </span>
      </div>

      <img
        src={welvuraCookie}
        alt=""
        className="pointer-events-none absolute right-[7px] bottom-[-4px] h-[107px] w-auto max-w-[38%] origin-bottom-right object-contain drop-shadow-[0_8px_24px_rgb(0_0_0/45%)] -translate-x-[15px] -translate-y-[20px] scale-[1.15]"
        aria-hidden
      />
    </button>
  )
}
