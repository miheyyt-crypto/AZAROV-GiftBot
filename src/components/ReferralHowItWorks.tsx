import { REFERRAL_ACTIVATION_REWARD } from '@/lib/constants'

const steps = [
  {
    title: 'Отправь ссылку',
    text: 'Своим — в личку или в свой чат. По ней друг откроет приложение, и мы запомним, что он твой.',
    tone: 'purple' as const,
  },
  {
    title: 'Друг открывает приложение',
    text: 'По твоей ссылке друг входит через Telegram. Пока это только приглашение — монеты ещё не начисляются.',
    tone: 'purple' as const,
  },
  {
    title: 'Друг подключает Kick',
    text: 'Когда приглашённый успешно привязывает Kick через OAuth, реферал подтверждается.',
    tone: 'purple' as const,
  },
  {
    title: `Оба получают по ${REFERRAL_ACTIVATION_REWARD} монет`,
    text: 'Один раз за каждого нового друга: +500 тебе и +500 другу после его привязки Kick.',
    tone: 'gold' as const,
  },
  {
    title: 'Каждые 5 друзей — реферальный кейс',
    text: 'Копится по числу подтверждённых друзей (после Kick): как только счётчик доходит до цели, кейс появляется в разделе «Кейсы».',
    tone: 'purple' as const,
  },
] as const

const toneClass = {
  purple: 'bg-[#8e5af1] shadow-[0_0_14px_rgb(142_90_241/40%)]',
  gold: 'bg-[#f5c842] text-[#1a1200] shadow-[0_0_14px_rgb(245_200_66/35%)]',
} as const

export function ReferralHowItWorks() {
  return (
    <section className="rounded-[24px] border border-white/8 bg-[#16121f]/95 p-5">
      <h2 className="mb-5 text-lg font-bold text-white">Как это работает</h2>

      <ol className="space-y-5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              className={[
                'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
                toneClass[step.tone],
              ].join(' ')}
            >
              {index + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="font-semibold text-white">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-[#a1a1aa]">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-[16px] border border-white/6 bg-[#0f0d16] px-4 py-3.5">
        <p className="text-sm leading-relaxed text-[#a1a1aa]">
          Один Telegram-аккаунт — один реферер, навсегда.
          <br />
          Свою ссылку открыть нельзя. Сменить пригласившего после первого
          перехода по чужой ссылке тоже нельзя. Награда — только после Kick.
        </p>
      </div>
    </section>
  )
}
