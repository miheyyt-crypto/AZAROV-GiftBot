import { useCallback, useEffect, useRef, useState } from 'react'

import { ProfileSheet } from '@/components/ProfileSheet'
import { CoinIcon } from '@/components/CoinIcon'
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/format'
import {
  fetchNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '@/lib/notifications'
import type { UserNotification } from '@/types/user-notification'

interface NotificationsSheetProps {
  onClose: () => void
  onUnreadChange?: (count: number) => void
  /** When set, open this notification detail after list load (marks read via existing flow). */
  focusNotificationId?: string | null
}

function typeAccent(type: string): { emoji: string; unreadBorder: string } {
  if (type.includes('REJECTED') || type.includes('REJECT')) {
    return { emoji: '🔴', unreadBorder: 'border-pink/40' }
  }
  if (type.includes('APPROVED') || type.includes('APPROVE')) {
    return { emoji: '🟢', unreadBorder: 'border-emerald-400/40' }
  }
  if (type.includes('ORDER')) {
    return { emoji: '🛒', unreadBorder: 'border-sky-400/40' }
  }
  return { emoji: '🔔', unreadBorder: 'border-white/20' }
}

function NotificationDetail({
  item,
  onClose,
}: {
  item: UserNotification
  onClose: () => void
}) {
  const accent = typeAccent(item.type)
  const meta = item.metadata || {}
  const reason =
    typeof meta.rejectionReason === 'string' && meta.rejectionReason.trim()
      ? meta.rejectionReason.trim()
      : null
  const partnerName =
    typeof meta.partnerName === 'string' && meta.partnerName.trim()
      ? meta.partnerName.trim()
      : null
  const taskTitle =
    typeof meta.taskTitle === 'string' && meta.taskTitle.trim()
      ? meta.taskTitle.trim()
      : null
  const productName =
    typeof meta.productName === 'string' && meta.productName.trim()
      ? meta.productName.trim()
      : null
  const reward =
    typeof meta.reward === 'number' && Number.isFinite(meta.reward) && meta.reward > 0
      ? meta.reward
      : null

  return (
    <div className="fixed inset-0 z-[490] flex items-end justify-center">
      <button
        type="button"
        className="press-none ui-overlay absolute inset-0"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <section
        className="relative z-10 w-full max-w-lg ui-sheet px-5 pb-6 pt-5"
        style={{ paddingBottom: 'calc(1.25rem + var(--safe-area-bottom))' }}
      >
        <h3 className="text-lg font-bold text-white">
          {accent.emoji} {item.title}
        </h3>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
          {item.message}
        </p>

        {partnerName ? (
          <p className="mt-4 text-sm text-muted">
            Партнёр: <span className="text-white">{partnerName}</span>
          </p>
        ) : null}
        {taskTitle ? (
          <p className="mt-1 text-sm text-muted">
            Задание: <span className="text-white">{taskTitle}</span>
          </p>
        ) : null}
        {productName ? (
          <p className="mt-1 text-sm text-muted">
            Товар: <span className="text-white">{productName}</span>
          </p>
        ) : null}
        {reward != null ? (
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-gold">
            Награда: +{reward.toLocaleString('ru-RU')}
            <CoinIcon className="size-3.5" />
          </p>
        ) : null}
        {reason ? (
          <div className="mt-4 rounded-2xl border border-pink/25 bg-pink/10 px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-pink">Причина</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-white">{reason}</p>
          </div>
        ) : null}

        <p className="mt-4 text-xs text-muted">{formatAbsoluteDateTime(item.createdAt)}</p>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white"
        >
          Закрыть
        </button>
      </section>
    </div>
  )
}

export function NotificationsSheet({
  onClose,
  onUnreadChange,
  focusNotificationId = null,
}: NotificationsSheetProps) {
  const [items, setItems] = useState<UserNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [selected, setSelected] = useState<UserNotification | null>(null)
  const focusHandledRef = useRef(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const result = await fetchNotifications(50)
      setItems(result.notifications)
      setUnreadCount(result.unreadCount)
      onUnreadChange?.(result.unreadCount)
    } catch {
      setItems([])
      setLoadError('Не удалось загрузить уведомления.')
    } finally {
      setIsLoading(false)
    }
  }, [onUnreadChange])

  useEffect(() => {
    void load()
  }, [load])

  const handleOpen = useCallback(
    async (item: UserNotification) => {
      setSelected(item)
      if (item.read) {
        return
      }
      try {
        const result = await markNotificationAsRead(item.id)
        setItems((prev) =>
          prev.map((row) =>
            row.id === item.id
              ? { ...row, read: true, ...(result.notification || {}) }
              : row,
          ),
        )
        setUnreadCount(result.unreadCount)
        onUnreadChange?.(result.unreadCount)
        if (result.notification) {
          setSelected(result.notification)
        }
      } catch {
        // Keep UI open; list stays unread until retry.
      }
    },
    [onUnreadChange],
  )

  useEffect(() => {
    if (isLoading || loadError || focusHandledRef.current || !focusNotificationId) {
      return
    }
    const target = items.find((row) => row.id === focusNotificationId)
    if (!target) {
      return
    }
    focusHandledRef.current = true
    void handleOpen(target)
  }, [isLoading, loadError, focusNotificationId, items, handleOpen])

  async function handleReadAll() {
    if (markingAll || unreadCount === 0) {
      return
    }
    setMarkingAll(true)
    try {
      const result = await markAllNotificationsAsRead()
      setItems((prev) => prev.map((row) => ({ ...row, read: true })))
      setUnreadCount(result.unreadCount)
      onUnreadChange?.(result.unreadCount)
    } catch {
      // no-op; user can retry
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <>
      <ProfileSheet title="Уведомления" onClose={onClose} zClassName="z-[480]">
        {!isLoading && !loadError && items.length > 0 ? (
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              {unreadCount > 0
                ? `Непрочитанных: ${unreadCount}`
                : 'Все прочитаны'}
            </p>
            <button
              type="button"
              disabled={markingAll || unreadCount === 0}
              onClick={() => void handleReadAll()}
              className="rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white transition enabled:active:scale-[0.98] disabled:opacity-40"
            >
              {markingAll ? 'Читаем…' : 'Прочитать все'}
            </button>
          </div>
        ) : null}

        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted">Загрузка уведомлений...</p>
        ) : loadError ? (
          <div className="py-10 text-center">
            <p className="text-sm text-pink">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold text-white"
            >
              Повторить
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-3xl" aria-hidden>
              🔔
            </p>
            <p className="mt-3 text-sm text-muted">У вас пока нет уведомлений.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const accent = typeAccent(item.type)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void handleOpen(item)}
                    className={[
                      'flex w-full gap-3 rounded-[18px] border px-3.5 py-3.5 text-left transition active:scale-[0.99]',
                      item.read
                        ? 'border-white/8 bg-white/[0.03]'
                        : `bg-white/[0.07] ${accent.unreadBorder}`,
                    ].join(' ')}
                  >
                    <span className="mt-0.5 text-lg leading-none" aria-hidden>
                      {accent.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span
                          className={[
                            'min-w-0 flex-1 text-sm',
                            item.read ? 'font-medium text-white/90' : 'font-semibold text-white',
                          ].join(' ')}
                        >
                          {item.title}
                        </span>
                        {!item.read ? (
                          <span
                            className="mt-1 size-2 shrink-0 rounded-full bg-gold"
                            aria-label="Непрочитано"
                          />
                        ) : null}
                      </span>
                      <span className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">
                        {item.message}
                      </span>
                      <span className="mt-2 block text-[11px] text-muted/80">
                        {formatRelativeTime(item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </ProfileSheet>

      {selected ? (
        <NotificationDetail item={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  )
}