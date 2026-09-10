import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { WELVURA_TASKS_PATH } from '@/lib/welvura-referral'

type WelvuraReferralRequiredModalProps = {
  onClose: () => void
}

export function WelvuraReferralRequiredModal({ onClose }: WelvuraReferralRequiredModalProps) {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)

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

  function goToTask() {
    setVisible(false)
    window.setTimeout(() => {
      onClose()
      navigate(WELVURA_TASKS_PATH)
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
        aria-labelledby="welvura-referral-title"
        className={[
          'ui-sheet relative z-[1] mx-4 mb-4 w-full max-w-md rounded-[28px] border border-white/10',
          'bg-[#121018] p-5 shadow-[0_-12px_40px_rgb(0_0_0/45%)] sm:mb-0',
          'transition-transform duration-200',
          visible ? 'translate-y-0' : 'translate-y-6',
        ].join(' ')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="welvura-referral-title" className="text-lg font-bold text-white">
            Ты не являешься рефералом
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

        <p className="text-sm leading-relaxed text-[#b8b4c4]">
          Чтобы выводить деньги и покупать денежные товары, нужно выполнить первое задание Welvura.
        </p>

        <button
          type="button"
          onClick={goToTask}
          className={[
            'mt-5 flex min-h-12 w-full items-center justify-center rounded-full',
            'bg-kick text-[15px] font-bold text-[#0b1208]',
            'shadow-[0_0_20px_rgb(83_204_24/35%)] transition active:scale-[0.98]',
          ].join(' ')}
        >
          Выполнить
        </button>

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
