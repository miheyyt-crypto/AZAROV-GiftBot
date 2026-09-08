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
              className={['ui-pill min-h-11', isActive ? 'ui-pill-active' : ''].join(' ')}
              aria-pressed={isActive}
            >
              {category.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
