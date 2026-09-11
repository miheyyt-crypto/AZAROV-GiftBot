import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'

import { useUserAccount } from '@/hooks/useUserAccount'
import {
  FREE_CASE_KICK_PROFILE_PATH,
  FREE_CASE_TELEGRAM_TASK_PATH,
  getFreeCaseRequirements,
} from '@/lib/free-case-requirements'

function NudgeCard({
  emoji,
  title,
  subtitle,
  onClick,
}: {
  emoji: string
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'pointer-events-auto flex w-full items-start gap-3 rounded-2xl border border-white/10',
        'bg-[#14111c]/95 p-3 text-left shadow-[0_8px_24px_rgb(0_0_0/35%)] backdrop-blur-md',
        'transition-[transform,opacity] duration-200 active:scale-[0.98]',
      ].join(' ')}
    >
      <span className="text-xl leading-none" aria-hidden>
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-white/55">{subtitle}</span>
      </span>
    </button>
  )
}

export function FreeCaseRequirementNudges() {
  const account = useUserAccount()
  const navigate = useNavigate()
  const requirements = getFreeCaseRequirements(account)

  const showKick = !requirements.kickLinked
  const showTelegram = !requirements.telegramTaskCompleted

  if (!showKick && !showTelegram) {
    return null
  }

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 z-[61] mx-auto w-full max-w-lg px-4"
      style={{
        bottom: 'calc(var(--nav-height) + var(--safe-area-bottom) + 0.5rem)',
      }}
      aria-live="polite"
    >
      <div className="flex flex-col gap-2 transition-all duration-300">
        {showKick ? (
          <NudgeCard
            emoji="🎥"
            title="Привяжи Kick"
            subtitle="Привяжи аккаунт Kick, чтобы открыть бесплатный кейс"
            onClick={() => navigate(FREE_CASE_KICK_PROFILE_PATH)}
          />
        ) : null}
        {showTelegram ? (
          <NudgeCard
            emoji="📢"
            title="Подпишись на Telegram"
            subtitle="Выполни задание с подпиской и открой бесплатный кейс"
            onClick={() => navigate(FREE_CASE_TELEGRAM_TASK_PATH)}
          />
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
