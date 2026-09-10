import { Info, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useNotifications } from '@/components/NotificationProvider'
import { formatBalance } from '@/lib/balance'
import {
  createWithdrawalRequest,
  isValidWelvuraId,
  normalizeWelvuraIdInput,
  withdrawalErrorMessage,
  type WithdrawalRecord,
} from '@/lib/withdrawals'
import { WELVURA_REFERRAL_REQUIRED_CODE } from '@/lib/welvura-referral'
import type { CaseOpeningItem } from '@/types/profile'
import { WelvuraReferralRequiredModal } from '@/components/WelvuraReferralRequiredModal'

type WithdrawCashModalProps = {
  item: CaseOpeningItem
  onClose: () => void
  onSuccess: (withdrawal: WithdrawalRecord) => void
}

export function WithdrawCashModal({ item, onClose, onSuccess }: WithdrawCashModalProps) {
  const { showNotification } = useNotifications()
  const [welvuraId, setWelvuraId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [showReferralGate, setShowReferralGate] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    const previousOverflow = document.body.style.overflow
    // Inventory ProfileSheet already locks overflow; keep it locked while modal is open.
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(id)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  async function handleSubmit() {
    const trimmed = normalizeWelvuraIdInput(welvuraId).replace(/\D/g, '')
    if (!isValidWelvuraId(trimmed)) {
      setError('Укажи свой ID аккаунта Welvura (только цифры).')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await createWithdrawalRequest({
        itemId: item.id,
        welvuraId: trimmed,
      })
      if (!result.success || !result.withdrawal) {
        if (result.code === WELVURA_REFERRAL_REQUIRED_CODE) {
          setShowReferralGate(true)
          return
        }
        const message = withdrawalErrorMessage(result.code, result.message)
        console.error('[WITHDRAWAL]', {
          stage: 'create_rejected',
          code: result.code || null,
          itemId: item.id,
        })
        setError(message)
        showNotification({ type: 'error', title: 'Вывод', message })
        return
      }

      showNotification({
        type: 'success',
        title: 'Заявка на вывод отправлена',
        message: `${formatBalance(result.withdrawal.amountRub)} ₽ · ${result.withdrawal.id} · администратору`,
      })
      onSuccess(result.withdrawal)
      onClose()
    } catch (error) {
      console.error('[WITHDRAWAL]', error)
      const message = 'Не удалось создать заявку. Попробуйте ещё раз.'
      setError(message)
      showNotification({ type: 'error', title: 'Вывод', message })
    } finally {
      setBusy(false)
    }
  }

  if (typeof document === 'undefined') {
    return null
  }

  if (showReferralGate) {
    return (
      <WelvuraReferralRequiredModal
        onClose={() => {
          setShowReferralGate(false)
          onClose()
        }}
      />
    )
  }

  // Must render above ProfileSheet (z-[100]) — previously z-80 opened behind inventory.
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
        aria-labelledby="withdraw-modal-title"
        className={[
          'ui-sheet relative z-[1] w-full max-w-md rounded-t-[28px] border border-white/10 bg-[#121018] p-5 shadow-[0_-12px_40px_rgb(0_0_0/45%)] sm:rounded-[28px]',
          'transition-transform duration-200',
          visible ? 'translate-y-0' : 'translate-y-6',
        ].join(' ')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="withdraw-modal-title" className="text-lg font-bold text-white">
              Вывод средств
            </h2>
            <p className="mt-1 text-sm text-muted">Заявка на выплату на баланс Welvura</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full bg-white/5 text-white/70"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-3.5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Приз</p>
          <p className="mt-1 text-xl font-bold text-gold">
            {formatBalance(item.amount)} ₽
          </p>
          <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-muted">Способ вывода</p>
          <p className="mt-1 text-sm font-semibold text-white">Баланс Welvura</p>
        </div>

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-[#b8b4c4]">ID аккаунта Welvura</span>
          <input
            type="text"
            inputMode="numeric"
            value={welvuraId}
            disabled={busy}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Например: 12345678"
            maxLength={32}
            onChange={(event) => {
              setWelvuraId(event.target.value.replace(/\D/g, '').slice(0, 32))
              setError(null)
            }}
            className={[
              'min-h-12 w-full rounded-[16px] border border-white/10 bg-[#0b0a10] px-4',
              'text-sm text-white placeholder:text-[#6f6a7c] outline-none',
              'focus:border-kick/40 focus:ring-1 focus:ring-kick/25',
              'disabled:opacity-60',
            ].join(' ')}
          />
        </label>

        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[#8b8699]">
          <Info size={14} className="mt-0.5 shrink-0 text-kick" />
          Только цифры — ID из твоего аккаунта Welvura. Администратор зачислит средства после проверки.
        </p>

        {error ? <p className="mt-3 text-sm text-pink">{error}</p> : null}

        <button
          type="button"
          disabled={busy || !welvuraId.trim()}
          onClick={() => void handleSubmit()}
          className={[
            'mt-5 flex min-h-12 w-full items-center justify-center rounded-full',
            'bg-kick text-[15px] font-bold text-[#0b1208]',
            'shadow-[0_0_20px_rgb(83_204_24/35%)] transition active:scale-[0.98]',
            'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
          ].join(' ')}
        >
          {busy ? 'Отправка…' : 'Отправить заявку'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
