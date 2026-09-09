import { ChevronRight, Lock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { ROUTES } from '@/lib/constants'

export function CommunityAccessBanner() {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => navigate(ROUTES.communityAccess)}
      className={[
        'interactive relative w-full overflow-hidden rounded-[22px] border p-5 text-left min-h-[156px]',
        'border-kick/30 bg-gradient-to-r from-[#14351f] via-[#121818] to-[#121018]',
        'shadow-[0_8px_24px_rgb(0_0_0/25%)]',
      ].join(' ')}
    >
      <div
        className="pointer-events-none absolute -right-6 -top-8 size-40 rounded-full bg-kick/15 blur-2xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 right-4 flex size-24 items-center justify-center rounded-full bg-white/[0.04]"
        aria-hidden
      >
        <Lock size={40} className="text-kick/80" />
      </div>

      <div className="relative z-10 flex min-h-[116px] flex-col">
        <div className="min-w-0 max-w-[70%]">
          <h3 className="text-xl font-bold text-white">🔒 Закрытое сообщество</h3>
          <p className="mt-1 text-sm text-white/75">
            Получи доступ в эксклюзивный секретный чат
          </p>
        </div>

        <div className="mt-auto pt-5">
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: 12 }, (_, index) => (
              <span
                key={index}
                className={[
                  'h-1 w-3 rounded-full',
                  index === 0 ? 'bg-kick' : 'bg-white/20',
                ].join(' ')}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center gap-1 text-sm font-medium text-white">
            Получить доступ
            <ChevronRight size={16} aria-hidden />
          </div>
        </div>
      </div>
    </button>
  )
}
