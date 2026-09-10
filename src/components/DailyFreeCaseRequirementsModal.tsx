import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import {
  FREE_CASE_KICK_PROFILE_PATH,
  FREE_CASE_TELEGRAM_TASK_PATH,
  type FreeCaseRequirements,
} from '@/lib/free-case-requirements'

type DailyFreeCaseRequirementsModalProps = {
  requirements: FreeCaseRequirements
  onClose: () => void
}

export function DailyFreeCaseRequirementsModal({
  requirements,
  onClose,
}: DailyFreeCaseRequirementsModalProps) {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)

  const needKick = !requirements.kickLinked
  const needTelegram = !requirements.telegramTaskCompleted
  const almostReady = (needKick && !needTelegram) || (!needKick && needTelegram)

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

  function goKick() {
    setVisible(false)
    window.setTimeout(() => {
      onClose()
      navigate(FREE_CASE_KICK_PROFILE_PATH)
    }, 120)
  }

  function goTelegramTask() {
    setVisible(false)
    window.setTimeout(() => {
      onClose()
      navigate(FREE_CASE_TELEGRAM_TASK_PATH)
    }, 120)
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Закрыть"
        className={[
          'absolute inset-0 bg-black/70 transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="free-case-req-title"
        className={[
          'ui-sheet relative z-[1] mx-4 mb-4 w-full max-w-md rounded-[28px] border border-white/10',
          'bg-[#121018] p-5 shadow-[0_-12px_40px_rgb(0_0_0/45%)] sm:mb-0',
          'transition-transform duration-200',
          visible ? 'translate-y-0' : 'translate-y-6',
        ].join(' ')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="free-case-req-title" className="text-lg font-bold text-white">
            {almostReady ? '🎁 Почти готово!' : '🎁 Бесплатный кейс пока недоступен'}
          </h2>
          <button
            type="button"
            onClick={close}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        {almostReady ? (
          <p className="text-sm leading-relaxed text-[#b8b4c4]">
            {needKick
              ? 'Осталось привязать Kick аккаунт.'
              : 'Осталось выполнить задание с подпиской на Telegram-канал.'}
          </p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-[#b8b4c4]">
              Чтобы открыть кейс, нужно выполнить два условия:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-white/85">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-white/35" aria-hidden>
                  ○
                </span>
                <span>Привязать Kick</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-white/35" aria-hidden>
                  ○
                </span>
                <span>Выполнить задание с подпиской</span>
              </li>
            </ul>
            <p className="mt-3 text-sm leading-relaxed text-[#b8b4c4]">
              После выполнения обоих условий бесплатный кейс станет доступен.
            </p>
          </>
        )}

        {needKick ? (
          <button
            type="button"
            onClick={goKick}
            className={[
              'mt-5 flex min-h-12 w-full items-center justify-center rounded-full',
              'bg-kick text-[15px] font-bold text-[#0b1208]',
              'shadow-[0_0_20px_rgb(83_204_24/35%)] transition active:scale-[0.98]',
            ].join(' ')}
          >
            Привязать Kick
          </button>
        ) : null}

        {needTelegram ? (
          <button
            type="button"
            onClick={goTelegramTask}
            className={[
              needKick ? 'mt-2' : 'mt-5',
              'flex min-h-12 w-full items-center justify-center rounded-full',
              'bg-gradient-to-r from-[#fff6c8] via-[#ffd84a] to-[#f0a512] text-[15px] font-bold text-[#1a1200]',
              'shadow-[0_8px_28px_rgb(244_201_93/35%)] transition active:scale-[0.98]',
            ].join(' ')}
          >
            Выполнить задание
          </button>
        ) : null}

        <button
          type="button"
          onClick={close}
          className="mt-2 w-full py-2 text-sm font-medium text-white/50 transition-colors active:text-white/80"
        >
          Закрыть
        </button>
      </div>
    </div>,
    document.body,
  )
}
