import { Lock } from 'lucide-react'

import { TELEGRAM_SUPPORT_URL } from '@/lib/constants'
import { getTelegramWebApp } from '@/lib/telegram'

interface BlockedAccountScreenProps {
  title?: string
  message?: string
  detail?: string
}

export function BlockedAccountScreen({
  title = 'Аккаунт заблокирован',
  message = 'Обнаружена регистрация с устройства или сети, которая уже использовалась другим аккаунтом.',
  detail = 'Если это ошибка, обратитесь в техническую поддержку.',
}: BlockedAccountScreenProps) {
  const openSupport = () => {
    const webApp = getTelegramWebApp()
    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(TELEGRAM_SUPPORT_URL)
      return
    }
    window.open(TELEGRAM_SUPPORT_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-bg-dark px-5 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#141218]/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
          <Lock size={22} className="text-kick" aria-hidden />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">{message}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">{detail}</p>
        <button
          type="button"
          onClick={openSupport}
          className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-kick px-4 text-sm font-bold text-black transition hover:brightness-110"
        >
          Написать в поддержку
        </button>
      </div>
    </div>
  )
}
