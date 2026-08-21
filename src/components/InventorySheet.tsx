import { useEffect, useState } from 'react'

import { ProfileSheet } from '@/components/ProfileSheet'
import { formatBalance } from '@/lib/balance'
import { fetchInventory, formatTransactionDate } from '@/lib/profile'
import type { InventoryItem } from '@/types/profile'

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

export function InventorySheet({ onClose }: InventorySheetProps) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void fetchInventory().then((list) => {
      setItems(list)
      setIsLoading(false)
    })
  }, [])

  return (
    <ProfileSheet title="Инвентарь" onClose={onClose}>
      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted">Загружаем инвентарь...</p>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          Пока нет предметов из кейсов
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
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
                <p className="shrink-0 text-sm font-semibold text-gold">
                  {item.currency === 'RUB'
                    ? `${formatBalance(item.amount)} ₽`
                    : `🪙 ${formatBalance(item.amount)}`}
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
