import { useEffect, useState } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import { ProfileSheet } from '@/components/ProfileSheet'
import { WithdrawCashModal } from '@/components/WithdrawCashModal'
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

function withdrawalButtonLabel(item: CaseOpeningItem): string {
  const status = String(item.withdrawalStatus || 'AVAILABLE').toUpperCase()
  if (status === 'PENDING_WITHDRAWAL') {
    return 'Ожидает вывода'
  }
  if (status === 'WITHDRAWN') {
    return 'Выведено'
  }
  return 'Вывести'
}

export function InventorySheet({ onClose }: InventorySheetProps) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [caseOpenings, setCaseOpenings] = useState<CaseOpeningItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [withdrawItem, setWithdrawItem] = useState<CaseOpeningItem | null>(null)

  async function reload() {
    const result = await fetchInventory()
    setItems(result.items)
    setCaseOpenings(result.caseOpenings)
  }

  useEffect(() => {
    void reload().finally(() => setIsLoading(false))
  }, [])

  const empty = items.length === 0 && caseOpenings.length === 0

  return (
    <>
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

            {caseOpenings.map((item) => {
              const status = String(item.withdrawalStatus || 'AVAILABLE').toUpperCase()
              const isRub = item.currency === 'RUB'
              const canWithdraw = Boolean(item.canWithdraw)
              const pending = status === 'PENDING_WITHDRAWAL'
              const withdrawn = status === 'WITHDRAWN'

              return (
                <article
                  key={item.id}
                  className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-white">{item.name}</p>
                      <p className="mt-1 text-xs text-muted">
                        {isRub ? 'Денежный приз' : item.caseName}
                      </p>
                      {!isRub ? (
                        <p className="mt-1 text-xs text-muted">
                          {rarityLabels[item.rarity] || item.rarity}
                        </p>
                      ) : null}
                    </div>
                    <p className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-gold">
                      {isRub ? (
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

                  {pending ? (
                    <p className="mt-2 text-xs font-medium text-amber-300">🟡 На проверке</p>
                  ) : null}
                  {withdrawn ? (
                    <p className="mt-2 text-xs font-medium text-kick">🟢 Выведено</p>
                  ) : null}

                  {isRub ? (
                    <button
                      type="button"
                      disabled={!canWithdraw}
                      onClick={() => setWithdrawItem(item)}
                      className={[
                        'mt-3 flex min-h-11 w-full items-center justify-center rounded-full px-4',
                        'text-sm font-bold transition active:scale-[0.98]',
                        canWithdraw
                          ? 'bg-kick text-[#0b1208] shadow-[0_0_16px_rgb(83_204_24/30%)]'
                          : 'cursor-not-allowed border border-white/10 bg-white/[0.04] text-muted',
                      ].join(' ')}
                    >
                      {withdrawalButtonLabel(item)}
                    </button>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </ProfileSheet>

      {withdrawItem ? (
        <WithdrawCashModal
          item={withdrawItem}
          onClose={() => setWithdrawItem(null)}
          onSuccess={() => {
            void reload()
          }}
        />
      ) : null}
    </>
  )
}
