import { Link } from 'react-router-dom'

import { ROUTES } from '@/lib/constants'

export function NotFoundPage() {
  return (
    <div
      className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center"
      style={{ paddingTop: 'calc(1rem + var(--safe-area-top))' }}
    >
      <p className="text-4xl" aria-hidden>
        🔍
      </p>
      <h1 className="mt-4 text-2xl font-bold text-white">Страница не найдена</h1>
      <p className="mt-2 max-w-xs text-sm text-muted">
        Такой страницы нет. Вернись на главную и продолжи пользоваться приложением.
      </p>
      <Link
        to={ROUTES.home}
        className="mt-6 rounded-2xl bg-[#9b4dff] px-5 py-3 text-sm font-semibold text-white shadow-[0_0_16px_rgb(155_77_255/35%)]"
      >
        На главную
      </Link>
    </div>
  )
}
