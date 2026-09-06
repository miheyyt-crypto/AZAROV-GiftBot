import { useEffect, useRef } from 'react'

import { getTelegramLoginBotUsername } from '@/lib/constants'
import type { TelegramLoginWidgetUser } from '@/types/auth'

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramLoginWidgetUser) => void
  }
}

interface TelegramLoginButtonProps {
  onAuth: (user: TelegramLoginWidgetUser) => void
  disabled?: boolean
}

/**
 * Official Telegram Login Widget.
 * BOT_TOKEN is never used here — only bot username for the widget script.
 */
export function TelegramLoginButton({ onAuth, disabled = false }: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onAuthRef = useRef(onAuth)
  onAuthRef.current = onAuth

  useEffect(() => {
    const botUsername = getTelegramLoginBotUsername()
    const container = containerRef.current
    if (!container || !botUsername) {
      return
    }

    window.onTelegramAuth = (user: TelegramLoginWidgetUser) => {
      onAuthRef.current(user)
    }

    container.replaceChildren()

    const script = document.createElement('script')
    // Cache-buster so remounts (StrictMode / retry after error) re-render the iframe button.
    script.src = `https://telegram.org/js/telegram-widget.js?22&_=${Date.now()}`
    script.async = true
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '12')
    script.setAttribute('data-request-access', 'write')
    script.setAttribute('data-userpic', 'false')
    // Official legacy Login Widget callback mode (not data-auth-url redirect).
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    container.appendChild(script)

    return () => {
      delete window.onTelegramAuth
      container.replaceChildren()
    }
  }, [])

  const botUsername = getTelegramLoginBotUsername()

  if (!botUsername) {
    return (
      <p className="text-center text-sm text-muted">
        Логин через Telegram временно недоступен: не задан username бота.
      </p>
    )
  }

  return (
    <div
      ref={containerRef}
      className={[
        'flex min-h-12 items-center justify-center',
        disabled ? 'pointer-events-none opacity-50' : '',
      ].join(' ')}
      aria-busy={disabled}
    />
  )
}
