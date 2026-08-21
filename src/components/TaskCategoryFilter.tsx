import type { FilterCategory } from '@/types'

interface CategoryOption {
  id: FilterCategory
  label: string
  isPartner?: boolean
}

const taskCategories: CategoryOption[] = [
  { id: 'all', label: 'Все' },
  { id: 'kick', label: 'Kick' },
  { id: 'telegram', label: 'TG' },
  { id: 'social', label: 'Соцсети' },
]

const partnerCategory: CategoryOption = {
  id: 'partners',
  label: 'Партнёры',
  isPartner: true,
}

interface TaskCategoryFilterProps {
  active: FilterCategory
  onChange: (category: FilterCategory) => void
}

function CategoryPill({
  id,
  label,
  isActive,
  isPartner,
  onChange,
}: CategoryOption & {
  isActive: boolean
  onChange: (category: FilterCategory) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(id)}
      className={[
        'shrink-0 rounded-full px-5 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-200',
        isActive
          ? isPartner
            ? 'bg-gold text-[#1a1200] shadow-[var(--glow-gold)]'
            : 'bg-neon-purple text-white shadow-[var(--glow-purple)]'
          : 'border border-white/10 bg-white/[0.04] text-white/85',
      ].join(' ')}
      aria-pressed={isActive}
    >
      {label}
    </button>
  )
}

export function TaskCategoryFilter({
  active,
  onChange,
}: TaskCategoryFilterProps) {
  return (
    <div className="scrollbar-hide -mx-4 overflow-x-auto px-4">
      <div className="flex w-max items-center gap-2 pb-1">
        {taskCategories.map((category) => (
          <CategoryPill
            key={category.id}
            {...category}
            isActive={active === category.id}
            onChange={onChange}
          />
        ))}

        <span className="mx-1 h-6 w-px shrink-0 bg-white/10" aria-hidden />

        <CategoryPill
          {...partnerCategory}
          isActive={active === partnerCategory.id}
          onChange={onChange}
        />
      </div>
    </div>
  )
}
