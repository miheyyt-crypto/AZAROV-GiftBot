import { Gift, Link2, UserPlus, Users, Zap } from 'lucide-react'

import { REFERRAL_ACTIVATION_REWARD, REFERRAL_CASE_EVERY } from '@/lib/constants'

const steps = [
  {
    n: 1,
    title: 'Пригласи друга',
    text: 'Поделись своей ссылкой через Telegram',
    Icon: UserPlus,
    accent: {
      border: 'border-[rgb(0_200_83/28%)]',
      glow: 'shadow-[0_0_22px_rgb(0_200_83/12%)]',
      iconBg: 'bg-[rgb(0_200_83/16%)] text-[#3DFF8A] shadow-[0_0_18px_rgb(0_200_83/30%)]',
      number: 'text-[rgb(0_200_83/28%)]',
      wash: 'bg-[radial-gradient(circle_at_20%_15%,rgb(0_200_83/14%),transparent_55%)]',
    },
  },
  {
    n: 2,
    title: 'Друг привязывает Kick',
    text: `Вы оба получаете по ${REFERRAL_ACTIVATION_REWARD.toLocaleString('ru-RU')} монет`,
    Icon: Link2,
    accent: {
      border: 'border-[rgb(33_150_255/30%)]',
      glow: 'shadow-[0_0_22px_rgb(33_150_255/12%)]',
      iconBg: 'bg-[rgb(33_150_255/16%)] text-[#64B5FF] shadow-[0_0_18px_rgb(33_150_255/30%)]',
      number: 'text-[rgb(33_150_255/28%)]',
      wash: 'bg-[radial-gradient(circle_at_20%_15%,rgb(33_150_255/14%),transparent_55%)]',
    },
  },
  {
    n: 3,
    title: 'Собирай активных друзей',
    text: `Каждые ${REFERRAL_CASE_EVERY} подтверждённых друзей — прогресс к кейсу`,
    Icon: Users,
    accent: {
      border: 'border-[rgb(139_61_255/30%)]',
      glow: 'shadow-[0_0_22px_rgb(139_61_255/14%)]',
      iconBg: 'bg-[rgb(139_61_255/18%)] text-[#C084FC] shadow-[0_0_18px_rgb(139_61_255/35%)]',
      number: 'text-[rgb(139_61_255/28%)]',
      wash: 'bg-[radial-gradient(circle_at_20%_15%,rgb(139_61_255/16%),transparent_55%)]',
    },
  },
  {
    n: 4,
    title: 'Кейс тебе',
    text: 'Открывай реферальный кейс и забирай награды',
    Icon: Gift,
    accent: {
      border: 'border-[rgb(255_179_0/28%)]',
      glow: 'shadow-[0_0_22px_rgb(255_179_0/12%)]',
      iconBg: 'bg-[rgb(255_179_0/14%)] text-[#FFD54F] shadow-[0_0_18px_rgb(255_179_0/28%)]',
      number: 'text-[rgb(255_179_0/30%)]',
      wash: 'bg-[radial-gradient(circle_at_20%_15%,rgb(255_179_0/14%),transparent_55%)]',
    },
  },
] as const

export function ReferralHowItWorks() {
  return (
    <section className="pb-2">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(145deg,#9b4dff,#6d28d9)] text-white shadow-[0_0_22px_rgb(139_61_255/45%)]">
          <Zap size={20} aria-hidden />
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-xl font-bold tracking-tight text-white">Как это работает</h2>
          <p className="mt-0.5 text-sm text-[#9b96ab]">4 шага до твоего реф-кейса</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {steps.map((step) => (
          <article
            key={step.n}
            className={[
              'friends-step relative min-h-[148px] overflow-hidden rounded-[20px] border bg-[#120e1a]/95 p-3.5',
              step.accent.border,
              step.accent.glow,
            ].join(' ')}
          >
            <div
              className={['pointer-events-none absolute inset-0', step.accent.wash].join(' ')}
              aria-hidden
            />
            <span
              className={[
                'absolute right-2.5 top-1 text-[42px] font-black leading-none',
                step.accent.number,
              ].join(' ')}
              aria-hidden
            >
              {step.n}
            </span>

            <div className="relative z-10 flex h-full flex-col">
              <span
                className={[
                  'mb-3 flex size-11 items-center justify-center rounded-[14px]',
                  step.accent.iconBg,
                ].join(' ')}
              >
                <step.Icon size={20} aria-hidden />
              </span>
              <h3 className="pr-6 text-[13px] font-bold leading-snug text-white">{step.title}</h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#9b96ab]">{step.text}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 rounded-[16px] border border-white/[0.06] bg-[#0f0d16]/90 px-4 py-3.5">
        <p className="text-[12px] leading-relaxed text-[#9b96ab]">
          Один Telegram-аккаунт — один реферер, навсегда. Свою ссылку открыть нельзя. Награда
          начисляется только после успешной привязки Kick приглашённым другом.
        </p>
      </div>
    </section>
  )
}
