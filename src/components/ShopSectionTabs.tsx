import { ShoppingBag, Box } from 'lucide-react'

import type { ShopSection } from '@/types/shop'

interface ShopSectionTabsProps {
  active: ShopSection
  onChange: (section: ShopSection) => void
}

export function ShopSectionTabs({ active, onChange }: ShopSectionTabsProps) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-[18px] border border-white/[0.08] bg-white/[0.035] p-1">
      <button
        type="button"
        onClick={() => onChange('shop')}
        className={[
          'flex min-h-11 items-center justify-center gap-2 rounded-[14px] px-3 py-2.5 text-sm font-semibold transition-all duration-200',
          active === 'shop'
            ? 'bg-bg-surface-elevated text-white shadow-[inset_0_0_0_1px_rgb(168_85_247/25%),var(--glow-purple)]'
            : 'text-muted',
        ].join(' ')}
      >
        <ShoppingBag size={16} aria-hidden />
        Магазин
      </button>
      <button
        type="button"
        onClick={() => onChange('cases')}
        className={[
          'flex min-h-11 items-center justify-center gap-2 rounded-[14px] px-3 py-2.5 text-sm font-semibold transition-all duration-200',
          active === 'cases'
            ? 'bg-bg-surface-elevated text-white shadow-[inset_0_0_0_1px_rgb(168_85_247/25%),var(--glow-purple)]'
            : 'text-muted',
        ].join(' ')}
      >
        <Box size={16} aria-hidden />
        Кейсы
      </button>
    </div>
  )
}
