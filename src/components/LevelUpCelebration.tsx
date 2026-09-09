import { useEffect, useState } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import type { LevelRewardGrant } from '@/lib/level-rewards'

interface LevelUpCelebrationProps {
  rewards: LevelRewardGrant[]
  totalAmount: number
  onClose: () => void
}

function formatCoins(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value)
}

export function LevelUpCelebration({ rewards, totalAmount, onClose }: LevelUpCelebrationProps) {
  const [visible, setVisible] = useState(false)
  const [displayTotal, setDisplayTotal] = useState(0)
  const multi = rewards.length > 1

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayTotal(totalAmount)
      return undefined
    }

    const durationMs = 700
    const started = performance.now()
    let raf = 0

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs)
      const eased = 1 - (1 - t) ** 3
      setDisplayTotal(Math.round(totalAmount * eased))
      if (t < 1) {
        raf = window.requestAnimationFrame(tick)
      }
    }

    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [totalAmount])

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center px-4">
      <button
        type="button"
        className={[
          'press-none ui-overlay absolute inset-0 transition-opacity duration-300',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-label="Закрыть"
        onClick={onClose}
      />

      <div
        className={[
          'level-up-burst pointer-events-none absolute inset-0',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-hidden
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="level-up-title"
        className={[
          'relative z-10 w-full max-w-sm overflow-hidden rounded-[28px] border border-gold/35',
          'bg-gradient-to-b from-[#2a1f3d] via-[#171521] to-[#0f0c16] p-6 text-center',
          'shadow-[0_0_48px_rgb(244_201_93/22%)] transition-all duration-300',
          visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-6 scale-95 opacity-0',
        ].join(' ')}
      >
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-gold/15 shadow-[0_0_28px_rgb(244_201_93/35%)]">
          <CoinIcon className="size-10" />
        </div>

        <h2 id="level-up-title" className="text-2xl font-bold tracking-tight text-white">
          {multi ? 'Новые уровни!' : 'Новый уровень!'}
        </h2>

        <ul className="mt-4 max-h-48 space-y-2 overflow-y-auto text-left">
          {rewards.map((item) => (
            <li
              key={item.level}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.04] px-3.5 py-2.5"
            >
              <span className="text-sm font-medium text-white/90">Уровень {item.level}</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold">
                +{formatCoins(item.amount)}
                <CoinIcon className="size-4" />
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-5 inline-flex items-center justify-center gap-2 text-3xl font-bold tabular-nums text-gold drop-shadow-[0_0_18px_rgb(244_201_93/35%)]">
          +{formatCoins(displayTotal)}
          <CoinIcon className="size-8" />
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-2xl bg-gradient-to-r from-purple to-neon-purple px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_20px_rgb(139_92_246/28%)]"
        >
          Отлично
        </button>
      </section>
    </div>
  )
}
