import { useEffect, useState } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import { ProfileSheet } from '@/components/ProfileSheet'
import { formatBalance } from '@/lib/balance'
import { fetchInventory, formatTransactionDate } from '@/lib/profile'
import type { CaseOpeningItem, InventoryItem } from '@/types/profile'

interface InventorySheetProps {
  onClose: () => void
}

const rarityLabels: Record<string, string> = {
  common: 'Обычный',
  uncommon: 'Необычный',
  rare: 'Редкий',
  epic: 'Эпический',
  legendary: 'Легендарный',
}

function formatInventoryTitle(item: InventoryItem): string {
  const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1
  if (item.type === 'streak-freeze') {
    return `🧊 Заморозка стрика × ${quantity}`
  }
  return quantity > 1 ? `${item.name} × ${quantity}` : item.name
}

export function InventorySheet({ onClose }: InventorySheetProps) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [caseOpenings, setCaseOpenings] = useState<CaseOpeningItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void fetchInventory().then((result) => {
      setItems(result.items)
      setCaseOpenings(result.caseOpenings)
      setIsLoading(false)
    })
  }, [])

  const empty = items.length === 0 && caseOpenings.length === 0

  return (
    <ProfileSheet title="Инвентарь" onClose={onClose}>
      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted">Загружаем инвентарь...</p>
      ) : empty ? (
        <p className="py-10 text-center text-sm text-muted">Пока нет предметов</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <article
              key={item.itemId}
              className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4"
            >
              <p className="font-medium text-white">{formatInventoryTitle(item)}</p>
              {item.type === 'streak-freeze' ? (
                <p className="mt-1 text-xs text-muted">
                  Срабатывает сама при пропуске одного дня стрика
                </p>
              ) : null}
            </article>
          ))}

          {caseOpenings.map((item) => (
            <article
              key={item.id}
              className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">{item.name}</p>
                  <p className="mt-1 text-xs text-muted">{item.caseName}</p>
                  <p className="mt-1 text-xs text-muted">
                    {rarityLabels[item.rarity] || item.rarity}
                  </p>
                </div>
                <p className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-gold">
                  {item.currency === 'RUB' ? (
                    <>{formatBalance(item.amount)} ₽</>
                  ) : (
                    <>
                      <CoinIcon className="size-3.5" />
                      {formatBalance(item.amount)}
                    </>
                  )}
                </p>
              </div>
              <p className="mt-2 text-xs text-muted">
                {formatTransactionDate(item.createdAt)}
              </p>
            </article>
          ))}
        </div>
      )}
    </ProfileSheet>
  )
}
