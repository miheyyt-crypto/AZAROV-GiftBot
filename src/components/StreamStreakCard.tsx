import { Lock } from 'lucide-react'

export function StreamStreakCard() {
  return (
    <article className="relative flex items-center gap-4 overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-gold/25 bg-gold/10 text-gold">
        <Lock size={22} aria-hidden />
      </div>

      <div className="relative z-10 min-w-0 flex-1">
        <h2 className="text-base font-semibold text-white">Стрик стримов</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Функция станет доступна после привязки Kick-аккаунта
        </p>
      </div>
    </article>
  )
}
