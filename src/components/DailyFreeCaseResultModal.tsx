import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { CoinIcon } from '@/components/CoinIcon'
import type { DailyFreeCaseReward } from '@/data/daily-free-case'
import { ROUTES } from '@/lib/constants'

interface DailyFreeCaseResultModalProps {
  reward: DailyFreeCaseReward
  onClose: () => void
}

export function DailyFreeCaseResultModal({ reward, onClose }: DailyFreeCaseResultModalProps) {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  function openCasesShop() {
    onClose()
    navigate(`${ROUTES.shop}?section=cases`)
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className={[
          'press-none absolute inset-0 bg-black/75 transition-opacity duration-200',
          'supports-[backdrop-filter]:bg-black/60',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
        aria-label="Закрыть"
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-free-case-result-title"
        className={[
          'relative z-10 mx-4 mb-4 w-full max-w-sm overflow-hidden rounded-[28px]',
          'border border-white/10 bg-[#161b22] px-5 pb-5 pt-6 text-center shadow-[0_24px_60px_rgb(0_0_0/55%)]',
          'transition-all duration-200',
          visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-95 opacity-0',
        ].join(' ')}
        style={{ paddingBottom: 'calc(1.25rem + var(--safe-area-bottom, 0px))' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80"
          aria-label="Закрыть"
        >
          <X size={16} />
        </button>

        <div className="mx-auto inline-flex items-center rounded-full border border-gold/40 bg-black/35 px-3 py-1">
          <span className="text-[10px] font-bold tracking-[0.08em] text-gold uppercase">
            Результат спина
          </span>
        </div>

        <h2
          id="daily-free-case-result-title"
          className="mt-3 text-[26px] font-bold tracking-tight text-white"
        >
          Поздравляем!
        </h2>

        <div className="mx-auto mt-5 flex size-[7.5rem] items-center justify-center rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_50%_30%,rgb(244_201_93/18%),transparent_65%),#121018]">
          <span className="text-5xl" aria-hidden>
            {reward.emoji}
          </span>
        </div>

        <p className="mt-4 text-lg font-bold text-white">{reward.name}</p>
        <p className="mt-1 text-sm text-white/55">Ты выиграл</p>

        <div className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1.5">
          {reward.rewardType === 'COINS' ? <CoinIcon className="size-4" /> : null}
          <span className="text-sm font-semibold text-gold">{reward.valueLabel}</span>
        </div>

        <div className="mt-5 rounded-[20px] border border-neon-purple/35 bg-neon-purple/5 px-4 py-4 text-left">
          <p className="text-sm font-semibold text-white">Хочешь шанс на приз больше?</p>
          <p className="mt-1.5 text-xs leading-relaxed text-white/55">
            Попробуй кейсы за монеты. Более ценные призы уже ждут тебя!
          </p>
          <button
            type="button"
            onClick={openCasesShop}
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-full bg-gradient-to-r from-[#a8ff4a] via-[#5dffb0] to-[#3de8ff] text-sm font-bold text-[#07120c] transition-transform duration-150 active:scale-[0.98]"
          >
            Открыть сейчас
          </button>
          <div className="mt-3 flex min-h-10 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3">
            <p className="text-xs font-semibold text-emerald-300">
              {reward.rewardType === 'COINS'
                ? '⭐ Монеты зачислены на баланс!'
                : reward.rewardType === 'GRAM'
                  ? '💠 GRAM зачислен на баланс!'
                  : '🎁 Предмет добавлен в коллекцию!'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full py-2 text-sm font-medium text-white/50 transition-colors active:text-white/80"
        >
          Закрыть
        </button>
      </section>
    </div>,
    document.body,
  )
}
