import { ShoppingBag, Box } from 'lucide-react'

import type { ShopSection } from '@/types/shop'

interface ShopSectionTabsProps {
  active: ShopSection
  onChange: (section: ShopSection) => void
}

export function ShopSectionTabs({ active, onChange }: ShopSectionTabsProps) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-[18px] border border-white/10 bg-white/[0.04] p-1">
      <button
        type="button"
        onClick={() => onChange('shop')}
        className={[
          'flex items-center justify-center gap-2 rounded-[14px] px-3 py-2.5 text-sm font-semibold transition-all duration-200',
          active === 'shop'
            ? 'bg-neon-purple text-white shadow-[var(--glow-purple)]'
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
          'flex items-center justify-center gap-2 rounded-[14px] px-3 py-2.5 text-sm font-semibold transition-all duration-200',
          active === 'cases'
            ? 'bg-neon-purple text-white shadow-[var(--glow-purple)]'
            : 'text-muted',
        ].join(' ')}
      >
        <Box size={16} aria-hidden />
        Кейсы
      </button>
    </div>
  )
}
