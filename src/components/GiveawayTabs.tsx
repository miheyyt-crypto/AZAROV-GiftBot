import { Gift, Trophy } from 'lucide-react'

import type { GiveawayTab } from '@/types/giveaway'

interface GiveawayTabsProps {
  active: GiveawayTab
  onChange: (tab: GiveawayTab) => void
}

const tabs: { id: GiveawayTab; label: string; Icon: typeof Gift }[] = [
  { id: 'active', label: 'Активные', Icon: Gift },
  { id: 'completed', label: 'Завершённые', Icon: Trophy },
]

export function GiveawayTabs({ active, onChange }: GiveawayTabsProps) {
  return (
    <div
      className="relative grid grid-cols-2 gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] p-1"
      role="tablist"
      aria-label="Розыгрыши"
    >
      <span
        aria-hidden
        className={[
          'pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full',
          'bg-kick/15 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          active === 'completed' ? 'translate-x-full' : 'translate-x-0',
        ].join(' ')}
      />

      {tabs.map(({ id, label, Icon }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            className={[
              'relative z-10 flex min-h-11 items-center justify-center gap-2 rounded-full px-2 py-2.5',
              'text-sm font-semibold transition-colors duration-200',
              isActive ? 'text-kick' : 'text-muted',
            ].join(' ')}
          >
            <Icon size={16} strokeWidth={2.25} aria-hidden />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
