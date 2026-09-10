import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import freezeImage from '@/assets/shop/freeze.png'
import { ProfileSheet } from '@/components/ProfileSheet'
import { WithdrawCashModal } from '@/components/WithdrawCashModal'
import { rewardImageForPrize } from '@/data/cases'
import { formatBalance } from '@/lib/balance'
import {
  claimInventoryCoins,
  fetchInventory,
  formatTransactionDate,
} from '@/lib/profile'
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

type InventoryTile =
  | {
      kind: 'inventory'
      key: string
      title: string
      image: string
      quantity: number
      description: string
      createdAt: string
      item: InventoryItem
    }
  | {
      kind: 'case'
      key: string
      title: string
      image: string
      quantity: number
      description: string
      createdAt: string
      item: CaseOpeningItem
      isRub: boolean
      canWithdraw: boolean
      canClaim: boolean
      statusLabel: string | null
    }

function freezeDescription(quantity: number): string {
  return quantity > 1
    ? `Заморозок: ${quantity}. Срабатывает сама при пропуске одного дня стрика.`
    : 'Срабатывает сама при пропуске одного дня стрика.'
}

function caseDescription(item: CaseOpeningItem, isRub: boolean): string {
  const parts = [
    isRub ? 'Денежный приз' : 'Монеты из кейса',
    item.caseName,
    rarityLabels[item.rarity] || item.rarity,
  ].filter(Boolean)
  return parts.join(' · ')
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

function coinClaimButtonLabel(item: CaseOpeningItem): string {
  const status = String(item.coinClaimStatus || 'AVAILABLE').toUpperCase()
  if (status === 'CLAIMED') {
    return 'Получено'
  }
  return 'Получить'
}

function buildTiles(
  items: InventoryItem[],
  caseOpenings: CaseOpeningItem[],
): InventoryTile[] {
  const tiles: InventoryTile[] = []

  for (const item of items) {
    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1
    if (item.type === 'streak-freeze') {
      tiles.push({
        kind: 'inventory',
        key: `inv:${item.itemId}`,
        title: quantity > 1 ? `Заморозка стрика × ${quantity}` : 'Заморозка стрика',
        image: freezeImage,
        quantity,
        description: freezeDescription(quantity),
        createdAt: item.createdAt,
        item,
      })
      continue
    }
    tiles.push({
      kind: 'inventory',
      key: `inv:${item.itemId}`,
      title: quantity > 1 ? `${item.name} × ${quantity}` : item.name,
      image: freezeImage,
      quantity,
      description: item.name,
      createdAt: item.createdAt,
      item,
    })
  }

  for (const item of caseOpenings) {
    const status = String(item.withdrawalStatus || 'AVAILABLE').toUpperCase()
    const coinStatus = String(item.coinClaimStatus || 'AVAILABLE').toUpperCase()
    const isRub = String(item.currency || '').toUpperCase() === 'RUB'
    const canWithdraw =
      typeof item.canWithdraw === 'boolean'
        ? item.canWithdraw
        : isRub && !['PENDING_WITHDRAWAL', 'WITHDRAWN'].includes(status) && Number(item.amount) >= 1
    const canClaim =
      typeof item.canClaim === 'boolean'
        ? item.canClaim
        : !isRub && coinStatus !== 'CLAIMED' && Number(item.amount) >= 1

    let statusLabel: string | null = null
    if (isRub) {
      if (status === 'PENDING_WITHDRAWAL') {
        statusLabel = 'На проверке'
      } else if (status === 'WITHDRAWN') {
        statusLabel = 'Выведено'
      }
    } else if (coinStatus === 'CLAIMED') {
      statusLabel = 'Получено'
    }

    tiles.push({
      kind: 'case',
      key: `case:${item.id}`,
      title: item.name,
      image: rewardImageForPrize(isRub ? 'RUB' : 'COINS', item.amount),
      quantity: 1,
      description: caseDescription(item, isRub),
      createdAt: item.createdAt,
      item,
      isRub,
      canWithdraw,
      canClaim,
      statusLabel,
    })
  }

  return tiles
}

type DetailModalProps = {
  tile: InventoryTile
  claiming: boolean
  claimError: string | null
  onClose: () => void
  onWithdraw: (item: CaseOpeningItem) => void
  onClaimCoins: (item: CaseOpeningItem) => void
}

function InventoryDetailModal({
  tile,
  claiming,
  claimError,
  onClose,
  onWithdraw,
  onClaimCoins,
}: DetailModalProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  if (typeof document === 'undefined') {
    return null
  }

  const caseTile = tile.kind === 'case' ? tile : null
  const amountLabel =
    caseTile &&
    (caseTile.isRub
      ? `${formatBalance(caseTile.item.amount)} ₽`
      : `${formatBalance(caseTile.item.amount)} монет`)

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Закрыть"
        className={[
          'absolute inset-0 bg-black/70 transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={[
          'relative z-[1] w-full max-w-md rounded-t-[28px] border border-white/10 bg-[#121018] p-5 shadow-[0_-12px_40px_rgb(0_0_0/45%)] sm:rounded-[28px]',
          'transition-transform duration-200',
          visible ? 'translate-y-0' : 'translate-y-6',
        ].join(' ')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-white">{tile.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mx-auto flex aspect-square w-40 items-center justify-center overflow-hidden rounded-[22px] border border-white/10 bg-[#0b0a10] p-3">
          <img
            src={tile.image}
            alt=""
            className={[
              'object-contain',
              tile.kind === 'case' && !tile.isRub ? 'h-[55%] w-[55%]' : 'h-[70%] w-[70%]',
            ].join(' ')}
            draggable={false}
          />
        </div>

        {amountLabel ? (
          <p className="mt-4 text-center text-xl font-bold text-gold">{amountLabel}</p>
        ) : null}

        <p className="mt-3 text-center text-sm leading-relaxed text-[#b8b4c4]">
          {tile.description}
        </p>

        <p className="mt-2 text-center text-xs text-muted">
          {formatTransactionDate(tile.createdAt)}
        </p>

        {caseTile?.statusLabel ? (
          <p
            className={[
              'mt-3 text-center text-xs font-medium',
              caseTile.statusLabel === 'Выведено' || caseTile.statusLabel === 'Получено'
                ? 'text-kick'
                : 'text-amber-300',
            ].join(' ')}
          >
            {caseTile.statusLabel === 'Выведено' || caseTile.statusLabel === 'Получено'
              ? '🟢'
              : '🟡'}{' '}
            {caseTile.statusLabel}
          </p>
        ) : null}

        {claimError ? (
          <p className="mt-3 text-center text-xs text-red-300">{claimError}</p>
        ) : null}

        {caseTile?.isRub ? (
          <button
            type="button"
            disabled={!caseTile.canWithdraw}
            onClick={() => {
              if (!caseTile.canWithdraw) {
                return
              }
              onWithdraw(caseTile.item)
            }}
            className={[
              'mt-5 flex min-h-12 w-full items-center justify-center rounded-full px-4',
              'text-sm font-bold transition active:scale-[0.98]',
              caseTile.canWithdraw
                ? 'bg-kick text-[#0b1208] shadow-[0_0_16px_rgb(83_204_24/30%)]'
                : 'cursor-not-allowed border border-white/10 bg-white/[0.04] text-muted',
            ].join(' ')}
          >
            {withdrawalButtonLabel(caseTile.item)}
          </button>
        ) : null}

        {caseTile && !caseTile.isRub ? (
          <button
            type="button"
            disabled={!caseTile.canClaim || claiming}
            onClick={() => {
              if (!caseTile.canClaim || claiming) {
                return
              }
              onClaimCoins(caseTile.item)
            }}
            className={[
              'mt-5 flex min-h-12 w-full items-center justify-center rounded-full px-4',
              'text-sm font-bold transition active:scale-[0.98]',
              caseTile.canClaim && !claiming
                ? 'bg-kick text-[#0b1208] shadow-[0_0_16px_rgb(83_204_24/30%)]'
                : 'cursor-not-allowed border border-white/10 bg-white/[0.04] text-muted',
            ].join(' ')}
          >
            {claiming ? 'Начисляем…' : coinClaimButtonLabel(caseTile.item)}
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

export function InventorySheet({ onClose }: InventorySheetProps) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [caseOpenings, setCaseOpenings] = useState<CaseOpeningItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selected, setSelected] = useState<InventoryTile | null>(null)
  const [withdrawItem, setWithdrawItem] = useState<CaseOpeningItem | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)

  async function reload() {
    const result = await fetchInventory()
    setItems(result.items)
    setCaseOpenings(result.caseOpenings)
    return result
  }

  useEffect(() => {
    void reload().finally(() => setIsLoading(false))
  }, [])

  const tiles = useMemo(() => buildTiles(items, caseOpenings), [items, caseOpenings])
  const empty = !isLoading && tiles.length === 0

  async function handleClaimCoins(item: CaseOpeningItem) {
    setClaimError(null)
    setClaiming(true)
    try {
      const result = await claimInventoryCoins(item.id)
      if (!result.success) {
        setClaimError(result.message || 'Не удалось получить монеты.')
        return
      }
      const next = await reload()
      const updated = next.caseOpenings.find((row) => row.id === item.id)
      if (updated) {
        const rebuilt = buildTiles(next.items, next.caseOpenings).find(
          (tile) => tile.kind === 'case' && tile.item.id === item.id,
        )
        setSelected(rebuilt || null)
      } else {
        setSelected(null)
      }
    } catch {
      setClaimError('Не удалось получить монеты. Попробуй ещё раз.')
    } finally {
      setClaiming(false)
    }
  }

  return (
    <>
      <ProfileSheet title="Инвентарь" onClose={onClose}>
        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted">Загружаем инвентарь...</p>
        ) : empty ? (
          <p className="py-10 text-center text-sm text-muted">Пока нет предметов</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                onClick={() => {
                  setClaimError(null)
                  setSelected(tile)
                }}
                className={[
                  'group relative aspect-square overflow-hidden rounded-[20px]',
                  'border border-white/10 bg-[#121018] text-left',
                  'transition-transform duration-150 active:scale-[0.97]',
                  'shadow-[0_8px_20px_rgb(0_0_0/28%)]',
                ].join(' ')}
                aria-label={tile.title}
              >
                <div className="absolute inset-0 flex items-center justify-center p-3">
                  <img
                    src={tile.image}
                    alt=""
                    className={[
                      'object-contain',
                      tile.kind === 'case' && !tile.isRub
                        ? 'h-[52%] w-[52%]'
                        : 'h-[70%] w-[70%]',
                    ].join(' ')}
                    draggable={false}
                  />
                </div>

                {tile.quantity > 1 ? (
                  <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white">
                    ×{tile.quantity}
                  </span>
                ) : null}

                {tile.kind === 'case' && tile.statusLabel ? (
                  <span
                    className={[
                      'absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      tile.statusLabel === 'Выведено' || tile.statusLabel === 'Получено'
                        ? 'bg-kick/20 text-kick'
                        : 'bg-amber-400/20 text-amber-200',
                    ].join(' ')}
                  >
                    {tile.statusLabel === 'Выведено' || tile.statusLabel === 'Получено'
                      ? '✓'
                      : '…'}
                  </span>
                ) : null}

                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2.5 pb-2.5 pt-8">
                  <p className="truncate text-[12px] font-semibold leading-tight text-white">
                    {tile.title}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </ProfileSheet>

      {selected && !withdrawItem ? (
        <InventoryDetailModal
          tile={selected}
          claiming={claiming}
          claimError={claimError}
          onClose={() => {
            setClaimError(null)
            setSelected(null)
          }}
          onWithdraw={(item) => {
            setWithdrawItem(item)
          }}
          onClaimCoins={(item) => {
            void handleClaimCoins(item)
          }}
        />
      ) : null}

      {withdrawItem ? (
        <WithdrawCashModal
          item={withdrawItem}
          onClose={() => {
            setWithdrawItem(null)
            void reload().then(() => {
              setSelected((prev) => {
                if (!prev || prev.kind !== 'case') {
                  return prev
                }
                return null
              })
            })
          }}
          onSuccess={() => {
            void reload()
            setSelected(null)
          }}
        />
      ) : null}
    </>
  )
}
