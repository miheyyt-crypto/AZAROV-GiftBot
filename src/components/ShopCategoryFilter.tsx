import { shopCategories } from '@/data/products'
import type { ProductCategory } from '@/types/shop'

interface ShopCategoryFilterProps {
  active: ProductCategory | 'all'
  onChange: (category: ProductCategory | 'all') => void
}

export function ShopCategoryFilter({ active, onChange }: ShopCategoryFilterProps) {
  return (
    <div className="scrollbar-hide -mx-4 overflow-x-auto px-4">
      <div className="flex w-max gap-2 pb-1">
        {shopCategories.map((category) => {
          const isActive = active === category.id

          return (
            <button
              key={category.id}
              type="button"
              onClick={() => onChange(category.id)}
              className={[
                'shrink-0 rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all duration-200',
                isActive
                  ? 'bg-[#9b4dff] text-white shadow-[0_0_16px_rgb(155_77_255/45%)]'
                  : 'bg-white/[0.06] text-white/80',
              ].join(' ')}
            >
              {category.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
