import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { CoinIcon } from '@/components/CoinIcon'
import { useNotifications } from '@/components/NotificationProvider'
import { formatBalance } from '@/lib/balance'
import { KICK_REQUIRED_CHANNEL_URL, getLaunchBotTaskUrl, TELEGRAM_CHANNEL_URL } from '@/lib/constants'
import { handleTaskAction } from '@/lib/tasks'
import { getTelegramWebApp } from '@/lib/telegram'
import type { Task, TaskCategory } from '@/types'

interface TaskDetailSheetProps {
  task: Task
  onClose: () => void
}

const iconWrapByCategory: Record<TaskCategory, string> = {
  kick: 'bg-gradient-to-br from-[#7ae045] to-[#53cc18]',
  telegram: 'bg-gradient-to-br from-[#38bdf8] to-[#0284c7]',
  social: 'bg-gradient-to-br from-[#ff9a4d] to-[#f97316]',
}

function isImageIcon(icon: string): boolean {
  return (
    icon.endsWith('.svg') ||
    icon.endsWith('.png') ||
    icon.includes('/assets/') ||
    icon.startsWith('data:')
  )
}

function openTelegramChannel(): void {
  const webApp = getTelegramWebApp()

  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(TELEGRAM_CHANNEL_URL)
    return
  }

  window.open(TELEGRAM_CHANNEL_URL, '_blank', 'noopener,noreferrer')
}

function openKickRequiredChannel(): void {
  const webApp = getTelegramWebApp()
  if (webApp?.openLink) {
    webApp.openLink(KICK_REQUIRED_CHANNEL_URL)
    return
  }
  window.open(KICK_REQUIRED_CHANNEL_URL, '_blank', 'noopener,noreferrer')
}

function openLaunchBotTask(): void {
  const url = getLaunchBotTaskUrl()
  const webApp = getTelegramWebApp()

  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url)
    // Bot API 7+: openTelegramLink keeps the Mini App open, so the same-bot
    // chat opens behind it. Close so the bot chat (Start) is on top.
    webApp.close()
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

const LAUNCH_BOT_AWAITING_KEY = 'task:launch-bot:awaiting'

function readLaunchBotAwaiting(): boolean {
  try {
    return sessionStorage.getItem(LAUNCH_BOT_AWAITING_KEY) === '1'
  } catch {
    return false
  }
}

function writeLaunchBotAwaiting(value: boolean): void {
  try {
    if (value) {
      sessionStorage.setItem(LAUNCH_BOT_AWAITING_KEY, '1')
    } else {
      sessionStorage.removeItem(LAUNCH_BOT_AWAITING_KEY)
    }
  } catch {
    // ignore storage failures in restricted WebViews
  }
}

export function TaskDetailSheet({ task, onClose }: TaskDetailSheetProps) {
  const { showNotification } = useNotifications()
  const [visible, setVisible] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [awaitingCheck, setAwaitingCheck] = useState(() =>
    task.type === 'telegram_bot_start' ? readLaunchBotAwaiting() : false,
  )

  const isCompleted = task.status === 'completed'
  const isLocked = task.status === 'locked'
  const isSubscribeTask = task.type === 'telegram_subscribe'
  const isLaunchBotTask = task.type === 'telegram_bot_start'
  const isKickFollowTask = task.type === 'kick_follow'
  const isTwoStepVerify = isSubscribeTask || isKickFollowTask || isLaunchBotTask
  const showProgress = Boolean(task.progress)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  function close() {
    setVisible(false)
    window.setTimeout(onClose, 180)
  }

  async function handleVerify() {
    if (isCompleted || isLocked || isLoading) {
      return
    }

    if (isTwoStepVerify && !awaitingCheck) {
      if (isSubscribeTask) {
        openTelegramChannel()
        showNotification({
          type: 'info',
          title: 'Подпишись на канал',
          message: 'После подписки вернись и нажми «Проверить».',
        })
      } else if (isLaunchBotTask) {
        writeLaunchBotAwaiting(true)
        setAwaitingCheck(true)
        openLaunchBotTask()
        return
      } else {
        openKickRequiredChannel()
        showNotification({
          type: 'info',
          title: 'Зафолловь канал Kick',
          message: 'После фоллоу на kick.com/azarov7777 вернись и нажми «Проверить».',
        })
      }
      setAwaitingCheck(true)
      return
    }

    setIsLoading(true)
    try {
      const result = await handleTaskAction(task.id)
      if (result.success) {
        if (isLaunchBotTask) {
          writeLaunchBotAwaiting(false)
        }
        showNotification({
          type: result.alreadyCompleted ? 'success' : 'reward',
          title: result.alreadyCompleted ? 'Уже выполнено' : 'Задание выполнено',
          message: result.message || `+${formatBalance(task.reward)} монет`,
        })
        close()
        return
      }

      const notDone =
        result.code === 'NOT_SUBSCRIBED' ||
        result.code === 'NOT_FOLLOWING' ||
        result.code === 'NOT_STARTED' ||
        result.code === 'FOLLOW_WEBHOOK_PENDING'
      showNotification({
        type: notDone ? 'warning' : 'error',
        title: notDone ? 'Ещё не выполнено' : 'Проверка не удалась',
        message:
          result.message ||
          (result.code === 'FOLLOW_WEBHOOK_PENDING'
            ? 'Отпишись от kick.com/azarov7777 и подпишись снова, подожди несколько секунд и нажми «Проверить».'
            : result.code === 'NOT_FOLLOWING'
              ? 'Сначала зафолловь канал kick.com/azarov7777.'
              : result.code === 'NOT_STARTED'
                ? 'Сначала запусти бота @AZAROV_GiftBot и нажми Start.'
                : notDone
                  ? 'Сначала подпишись на канал @azarov222.'
                  : 'Не удалось проверить задание. Попробуй ещё раз позже.'),
      })
    } finally {
      setIsLoading(false)
    }
  }

  const ctaLabel = isCompleted
    ? 'Выполнено ✓'
    : isLocked
      ? isKickFollowTask
        ? 'Сначала привяжи Kick'
        : 'Заблокировано'
      : isLoading
        ? 'Проверяем...'
        : isTwoStepVerify && !awaitingCheck
          ? isLaunchBotTask
            ? 'Запустить бота'
            : 'Выполнить'
          : 'Проверить'

  const progress = task.progress
  const progressPercent =
    progress && progress.required > 0
      ? Math.min((progress.current / progress.required) * 100, 100)
      : 0

  // Portal above BottomNav (z-50): inline fixed sheets stay under nav due to layout stacking.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <button
        type="button"
        className={[
          'press-none absolute inset-0 bg-black/75 backdrop-blur-[2px] transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-label="Закрыть"
        onClick={close}
      />

      <section
        className={[
          'relative z-10 flex w-full max-w-lg flex-col overflow-hidden ui-sheet transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        ].join(' ')}
        style={{ paddingBottom: 'calc(1.25rem + var(--safe-area-bottom))' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
      >
        <div className="flex justify-center pt-3">
          <span className="h-1.5 w-12 rounded-full bg-white/20" />
        </div>

        <header className="flex items-start justify-between gap-3 px-5 pt-2">
          <h2
            id="task-detail-title"
            className="pr-2 text-[22px] font-bold leading-tight tracking-tight text-white"
          >
            {task.title}
          </h2>
          <button
            type="button"
            onClick={close}
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </header>

        <div className="mt-4 px-5">
          <div className="flex items-center gap-3">
            {isImageIcon(task.icon) ? (
              <div
                className={[
                  'flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[16px]',
                  task.type === 'referral'
                    ? 'bg-gradient-to-br from-[#ff9a4d] to-[#f97316]'
                    : iconWrapByCategory[task.category],
                ].join(' ')}
              >
                <img
                  src={task.icon}
                  alt=""
                  className="size-10 object-contain"
                  aria-hidden
                />
              </div>
            ) : (
              <div
                className={[
                  'flex size-14 shrink-0 items-center justify-center rounded-[16px] text-2xl',
                  iconWrapByCategory[task.category],
                ].join(' ')}
                aria-hidden
              >
                {task.icon}
              </div>
            )}

            <p className="flex items-center gap-1.5 text-[26px] font-bold leading-none text-[#f0c45a]">
              <CoinIcon className="size-6" />
              {formatBalance(task.reward)}
            </p>
          </div>

          <p className="mt-4 text-[14px] leading-relaxed text-white/65">{task.description}</p>

          {isLocked && isKickFollowTask && (
            <p className="mt-3 text-sm text-amber-300/90">
              Привяжи Kick в профиле — после этого можно проверить фоллоу на azarov7777.
            </p>
          )}

          {showProgress && progress && (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-[13px]">
                <span className="text-white/55">Прогресс</span>
                <span className="font-medium text-white/70">
                  {progress.current} / {progress.required}
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuenow={progress.current}
                aria-valuemin={0}
                aria-valuemax={progress.required}
              >
                <div
                  className="h-full rounded-full bg-[#9d59ff] transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {isCompleted && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-kick-light">
              <Check size={16} aria-hidden />
              Задание уже выполнено
            </p>
          )}
        </div>

        <div className="mt-6 px-5">
          <button
            type="button"
            onClick={handleVerify}
            disabled={isCompleted || isLocked || isLoading}
            className={[
              'w-full rounded-[18px] px-4 py-3.5 text-base font-bold text-white',
              isCompleted || isLocked
                ? 'cursor-not-allowed bg-[#6b4aa8]/45 opacity-75'
                : 'bg-gradient-to-r from-[#8b3dff] to-[#b56bff] shadow-[0_0_24px_rgb(155_77_255/45%)]',
            ].join(' ')}
          >
            {ctaLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
