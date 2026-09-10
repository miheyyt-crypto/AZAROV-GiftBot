import { Settings, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  formatEachChanceLabel,
  formatGiftCountLabel,
  listDailyFreeCaseRarities,
  type DailyFreeCaseRarityConfig,
  type DailyFreeCaseReward,
} from '@/data/daily-free-case'

interface DailyFreeCaseContentsSheetProps {
  onClose: () => void
}

const rarityChrome: Record<
  DailyFreeCaseRarityConfig['id'],
  { panel: string; title: string; chance: string; sub: string }
> = {
  legendary: {
    panel: 'border-gold/40 bg-[radial-gradient(ellipse_at_20%_0%,rgb(244_201_93/14%),transparent_55%),#141218]',
    title: 'text-gold',
    chance: 'text-gold',
    sub: 'text-gold/55',
  },
  epic: {
    panel:
      'border-[#d000ff]/40 bg-[radial-gradient(ellipse_at_20%_0%,rgb(208_0_255/14%),transparent_55%),#141218]',
    title: 'text-[#e879f9]',
    chance: 'text-[#e879f9]',
    sub: 'text-[#e879f9]/55',
  },
  common: {
    panel:
      'border-slate-400/35 bg-[radial-gradient(ellipse_at_20%_0%,rgb(148_163_184/12%),transparent_55%),#141218]',
    title: 'text-slate-300',
    chance: 'text-slate-300',
    sub: 'text-slate-400/70',
  },
}

function ContentsCard({ reward }: { reward: DailyFreeCaseReward }) {
  return (
    <article className="overflow-hidden rounded-[16px] border border-white/8 bg-black/35">
      <div className="flex aspect-square items-center justify-center bg-[#101018] p-2">
        {reward.image ? (
          <img
            src={reward.image}
            alt=""
            className="max-h-[70%] max-w-[70%] object-contain"
            draggable={false}
          />
        ) : (
          <span className="text-[28px] leading-none" aria-hidden>
            {reward.emoji}
          </span>
        )}
      </div>
      <div className="space-y-0.5 px-1.5 py-2 text-center">
        <p className="truncate text-[10px] font-semibold leading-tight text-white">{reward.name}</p>
        <p className="truncate text-[9px] text-white/45">{reward.valueLabel}</p>
      </div>
    </article>
  )
}

export function DailyFreeCaseContentsSheet({ onClose }: DailyFreeCaseContentsSheetProps) {
  const [visible, setVisible] = useState(false)
  const rarities = listDailyFreeCaseRarities()

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  function close() {
    setVisible(false)
    window.setTimeout(onClose, 200)
  }

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center">
      <button
        type="button"
        className={[
          'press-none absolute inset-0 bg-black/75 transition-opacity duration-200',
          'supports-[backdrop-filter]:bg-black/55',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
        aria-label="Закрыть"
        onClick={close}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-free-case-contents-title"
        className={[
          'relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden',
          'rounded-t-[28px] border border-white/10 border-b-0 bg-[#121214]',
          'shadow-[0_-16px_48px_rgb(0_0_0/50%)] transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        ].join(' ')}
      >
        <div className="flex justify-center pt-3">
          <span className="h-1.5 w-12 rounded-full bg-white/20" />
        </div>

        <header className="flex items-center justify-between gap-3 px-5 pt-3 pb-1">
          <h2
            id="daily-free-case-contents-title"
            className="text-[22px] font-bold tracking-tight text-white"
          >
            NFT кейс
          </h2>
          <button
            type="button"
            onClick={close}
            className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex items-center justify-between gap-3 px-5 pb-3">
          <h3 className="text-base font-semibold text-white">Что внутри</h3>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted">
            <Settings size={12} aria-hidden />
            шансы реальные
          </span>
        </div>

        <div
          className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 pb-4"
          style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom, 0px))' }}
        >
          {rarities.map((rarity) => {
            const chrome = rarityChrome[rarity.id]
            const count = rarity.rewards.length
            return (
              <section
                key={rarity.id}
                className={['rounded-[22px] border p-3.5', chrome.panel].join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={['text-sm font-bold', chrome.title].join(' ')}>{rarity.name}</p>
                    <p className={['mt-0.5 text-[11px]', chrome.sub].join(' ')}>
                      {formatGiftCountLabel(count)} · у каждого{' '}
                      {formatEachChanceLabel(rarity.chance, count)}
                    </p>
                  </div>
                  <p className={['text-sm font-bold', chrome.chance].join(' ')}>{rarity.chance}%</p>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {rarity.rewards.map((reward) => (
                    <ContentsCard key={reward.id} reward={reward} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </section>
    </div>,
    document.body,
  )
}
