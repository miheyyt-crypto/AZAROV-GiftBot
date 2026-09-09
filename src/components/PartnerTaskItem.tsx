import { Check, Lock } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import { formatBalance } from '@/lib/balance'
import type { PartnerSubmission, PartnerTaskConfig, PartnerTaskStatus } from '@/types/partner'

interface PartnerTaskItemProps {
  index: number
  task: PartnerTaskConfig
  status: PartnerTaskStatus
  isLoading: boolean
  message?: string
  theme: 'dragonmoney' | 'stake'
  accountLinked: boolean
  submission?: PartnerSubmission | null
  onOpen: () => void
  onSubmit: (input: { partnerAccountId: string; screenshot: File }) => void
}

const themeStyles = {
  dragonmoney: {
    cardActive: 'border-[#c47a3a]/55 bg-[#1a1410]/95 shadow-[0_0_20px_rgb(196_122_58/14%)]',
    cardLocked: 'border-[#c47a3a]/25 bg-[#14110e]/80',
    cardDone: 'border-kick/35 bg-kick/5',
    badge: 'bg-[#c47a3a]/25 text-[#f0b35a]',
    badgeDone: 'bg-kick/20 text-kick-light',
    action: 'text-[#f0b35a]',
    reward: 'text-[#f0b35a]',
    input: 'border-[#c47a3a]/35 bg-black/30 focus:border-[#c47a3a]/70',
  },
  stake: {
    cardActive: 'border-[#1ec7fc]/50 bg-[#0e1620]/95 shadow-[0_0_20px_rgb(30_199_252/14%)]',
    cardLocked: 'border-[#1ec7fc]/20 bg-[#0c1218]/80',
    cardDone: 'border-kick/35 bg-kick/5',
    badge: 'bg-[#1ec7fc]/20 text-[#7ddffc]',
    badgeDone: 'bg-kick/20 text-kick-light',
    action: 'text-[#7ddffc]',
    reward: 'text-[#7ddffc]',
    input: 'border-[#1ec7fc]/30 bg-black/30 focus:border-[#1ec7fc]/70',
  },
} as const

export function PartnerTaskItem({
  index,
  task,
  status,
  isLoading,
  message,
  theme,
  accountLinked,
  submission,
  onOpen,
  onSubmit,
}: PartnerTaskItemProps) {
  const styles = themeStyles[theme]
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [partnerAccountId, setPartnerAccountId] = useState('')
  const [fileName, setFileName] = useState('')
  const [localError, setLocalError] = useState('')

  const isLocked = status === 'LOCKED'
  const isCompleted = status === 'COMPLETED'
  const isPending = status === 'PENDING'
  const isRejected = status === 'REJECTED'
  const canSubmit = status === 'AVAILABLE' || status === 'IN_PROGRESS' || status === 'REJECTED'
  const openLabel = task.actionLabel ?? 'Открыть >'
  const lockedHint = accountLinked ? 'После предыдущего этапа' : 'После привязки'
  const submitLabel = isRejected ? 'Отправить повторно' : 'Отправить на проверку'

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setFileName(file?.name ?? '')
    setLocalError('')
  }

  function handleSubmit() {
    const accountId = partnerAccountId.trim()
    const file = fileInputRef.current?.files?.[0]

    if (!/^[0-9]+$/.test(accountId)) {
      setLocalError('ID аккаунта должен содержать только цифры.')
      return
    }

    if (!file) {
      setLocalError('Добавьте скриншот (JPG, PNG или WEBP).')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setLocalError('Скриншот больше 5 МБ.')
      return
    }

    setLocalError('')
    onSubmit({ partnerAccountId: accountId, screenshot: file })
  }

  return (
    <article
      className={[
        'rounded-[20px] border p-4 transition-opacity',
        isLocked ? `${styles.cardLocked} opacity-[0.48]` : '',
        isCompleted ? styles.cardDone : '',
        !isLocked && !isCompleted ? styles.cardActive : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start gap-3">
        <div
          className={[
            'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            isCompleted ? styles.badgeDone : styles.badge,
          ].join(' ')}
        >
          {isCompleted ? (
            <Check size={16} aria-hidden />
          ) : isLocked ? (
            <Lock size={14} aria-hidden />
          ) : (
            index + 1
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3
            className={[
              'text-[15px] font-semibold leading-snug',
              isLocked ? 'text-white/75' : 'text-white',
            ].join(' ')}
          >
            {task.title}
          </h3>

          <p
            className={[
              'mt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap',
              isLocked ? 'text-white/45' : 'text-white/65',
            ].join(' ')}
          >
            {task.description}
          </p>

          <div className="mt-3 flex items-end justify-between gap-3">
            <p
              className={[
                'inline-flex items-center gap-1 text-sm font-bold',
                isLocked ? 'text-white/40' : styles.reward,
              ].join(' ')}
            >
              <CoinIcon className="size-3.5" />
              {formatBalance(task.reward)}
            </p>

            {isCompleted && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-kick-light">
                <Check size={14} aria-hidden />
                Выполнено
              </span>
            )}

            {isLocked && (
              <span className="text-xs font-medium text-white/40">{lockedHint}</span>
            )}

            {!isCompleted && !isLocked && !isPending && task.type !== 'account_link' && (
              <button
                type="button"
                onClick={onOpen}
                disabled={isLoading}
                className={['text-xs font-semibold disabled:opacity-60', styles.action].join(' ')}
              >
                {isLoading ? '...' : openLabel}
              </button>
            )}
          </div>

          {isPending && (
            <div className="mt-3 rounded-[14px] border border-amber-300/30 bg-amber-300/10 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-200">⏳ На проверке</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-100/80">
                Заявка отправлена администратору. Повторно отправить нельзя, пока идёт проверка.
              </p>
            </div>
          )}

          {isCompleted && (
            <div className="mt-3 rounded-[14px] border border-kick/30 bg-kick/10 px-3 py-2.5">
              <p className="text-xs font-semibold text-kick-light">✅ Подтверждено</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/70">
                Задание выполнено, награда начислена.
              </p>
            </div>
          )}

          {isRejected && (
            <p className="mt-2 rounded-lg border border-pink/30 bg-pink/10 px-3 py-2 text-xs text-pink">
              ❌ Заявка отклонена
              {submission?.rejectionReason ? `: ${submission.rejectionReason}` : '.'} Можно
              отправить новую заявку.
            </p>
          )}

          {canSubmit && (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder={
                  task.type === 'account_link' ? 'Введите Welvura ID' : 'ID партнёрского аккаунта'
                }
                value={partnerAccountId}
                onChange={(event) => setPartnerAccountId(event.target.value.replace(/[^\d]/g, ''))}
                disabled={isLoading}
                className={[
                  'w-full rounded-[14px] border px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35',
                  styles.input,
                ].join(' ')}
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-[12px] border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/85 disabled:opacity-60"
                >
                  {fileName ? 'Сменить скриншот' : '📷 Загрузить скриншот'}
                </button>
                {fileName && (
                  <span className="max-w-[180px] truncate text-[11px] text-white/50">{fileName}</span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={isLoading}
                className="w-full rounded-[14px] bg-white/10 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isLoading ? 'Отправка...' : submitLabel}
              </button>

              {task.type === 'account_link' && (
                <button
                  type="button"
                  onClick={onOpen}
                  disabled={isLoading}
                  className="w-full rounded-[14px] bg-kick px-3 py-2.5 text-sm font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-95 disabled:opacity-60"
                >
                  {isLoading ? '...' : openLabel}
                </button>
              )}
            </div>
          )}

          {(localError || message) && !isLocked && (
            <p className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
              {localError || message}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}
