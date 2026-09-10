import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import gramImage from '@/assets/cases/reward-gram.webp'
import { useNotifications } from '@/components/NotificationProvider'
import {
  canWithdrawGramm,
  formatGramm,
  formatGrammLabel,
  GRAM_LABEL,
  MIN_GRAM_WITHDRAWAL,
  missingGrammToWithdraw,
  parseGrammInput,
  roundGram,
} from '@/lib/gramm'
import {
  createGramWithdrawalRequest,
  gramWithdrawalErrorMessage,
} from '@/lib/gramm-withdrawals'
import { createPurchaseRequestId } from '@/lib/shop'

type GrammSheetProps = {
  balance: number
  onClose: () => void
}

type Step = 'overview' | 'amount'

export function GrammSheet({ balance, onClose }: GrammSheetProps) {
  const { showNotification } = useNotifications()
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState<Step>('overview')
  const [amountInput, setAmountInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const gramBalance = roundGram(balance)
  const canWithdraw = canWithdrawGramm(gramBalance)
  const missing = missingGrammToWithdraw(gramBalance)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    if (step === 'amount' && !amountInput) {
      setAmountInput(formatGramm(gramBalance))
    }
  }, [amountInput, gramBalance, step])

  const parsedAmount = useMemo(() => parseGrammInput(amountInput), [amountInput])
  const amountValid =
    parsedAmount != null && canWithdrawGramm(gramBalance, parsedAmount)

  function close() {
    setVisible(false)
    window.setTimeout(onClose, 180)
  }

  async function submitWithdrawal() {
    if (!amountValid || parsedAmount == null || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await createGramWithdrawalRequest({
        amount: parsedAmount,
        requestId: createPurchaseRequestId(),
      })
      if (!result.success) {
        const message = gramWithdrawalErrorMessage(result.code, result.message)
        setError(message)
        showNotification({ type: 'error', title: 'Вывод Gramm', message })
        return
      }
      showNotification({
        type: 'success',
        title: 'Заявка отправлена',
        message: `${formatGrammLabel(result.withdrawal?.amountGram ?? parsedAmount)} · ожидает обработки`,
      })
      close()
    } finally {
      setBusy(false)
    }
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center">
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
        aria-labelledby="gramm-sheet-title"
        className={[
          'ui-sheet relative z-[1] mx-4 mb-4 w-full max-w-md rounded-[28px] border border-white/10',
          'bg-[#121018] p-5 shadow-[0_-12px_40px_rgb(0_0_0/45%)] sm:mb-0',
          'transition-transform duration-200',
          visible ? 'translate-y-0' : 'translate-y-6',
        ].join(' ')}
        style={{ paddingBottom: 'calc(1.25rem + var(--safe-area-bottom))' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex size-11 items-center justify-center overflow-hidden rounded-xl bg-[#0b1a2a]"
              aria-hidden
            >
              <img src={gramImage} alt="" className="size-8 object-contain" draggable={false} />
            </div>
            <h2 id="gramm-sheet-title" className="text-lg font-bold text-white">
              Gramm
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        {step === 'overview' ? (
          <>
            <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-muted">
              Твой баланс
            </p>
            <p className="mt-2 text-[32px] font-bold leading-none tracking-tight text-white tabular-nums">
              {formatGrammLabel(gramBalance)}
            </p>

            <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="text-sm text-white/55">Минимальный вывод</p>
              <p className="mt-1 text-[15px] font-semibold text-white">
                {formatGrammLabel(MIN_GRAM_WITHDRAWAL)}
              </p>
            </div>

            <button
              type="button"
              disabled={!canWithdraw}
              onClick={() => {
                if (!canWithdraw) {
                  return
                }
                setError(null)
                setStep('amount')
              }}
              className={[
                'mt-5 flex min-h-12 w-full items-center justify-center rounded-full text-[15px] font-bold transition',
                canWithdraw
                  ? 'bg-gradient-to-r from-[#7dd3fc] via-[#38bdf8] to-[#0ea5e9] text-[#041018] shadow-[0_8px_24px_rgb(14_165_233/30%)] active:scale-[0.98]'
                  : 'cursor-not-allowed bg-white/10 text-white/40',
              ].join(' ')}
            >
              Вывести Gramm
            </button>

            {!canWithdraw ? (
              <p className="mt-3 text-center text-sm leading-relaxed text-white/50">
                Минимальная сумма для вывода — {formatGrammLabel(MIN_GRAM_WITHDRAWAL)}
                {missing > 0 ? (
                  <>
                    <br />
                    Тебе не хватает {formatGrammLabel(missing)}
                  </>
                ) : null}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-[#b8b4c4]">
              Введите сумму вывода. Доступно: {formatGrammLabel(gramBalance)}
            </p>

            <label className="mt-4 block">
              <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-muted">
                Сумма
              </span>
              <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  disabled={busy}
                  onChange={(event) => {
                    setAmountInput(event.target.value)
                    setError(null)
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold text-white outline-none tabular-nums placeholder:text-white/30"
                  placeholder="20"
                  aria-label="Сумма вывода Gramm"
                />
                <span className="shrink-0 text-sm font-semibold text-white/50">{GRAM_LABEL}</span>
              </div>
            </label>

            {error ? (
              <p className="mt-3 text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!amountValid || busy}
              onClick={() => {
                void submitWithdrawal()
              }}
              className={[
                'mt-5 flex min-h-12 w-full items-center justify-center rounded-full text-[15px] font-bold transition',
                amountValid && !busy
                  ? 'bg-gradient-to-r from-[#7dd3fc] via-[#38bdf8] to-[#0ea5e9] text-[#041018] shadow-[0_8px_24px_rgb(14_165_233/30%)] active:scale-[0.98]'
                  : 'cursor-not-allowed bg-white/10 text-white/40',
              ].join(' ')}
            >
              {busy ? 'Отправляем…' : 'Продолжить'}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStep('overview')
                setError(null)
              }}
              className="mt-2 w-full py-2 text-sm font-medium text-white/50 transition-colors active:text-white/80"
            >
              Назад
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
