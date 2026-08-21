import { NavLink } from 'react-router-dom'

import { navigationItems } from '@/data/navigation'
import { ROUTES } from '@/lib/constants'

export function BottomNav() {
  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3"
      style={{ paddingBottom: 'calc(0.7rem + var(--safe-area-bottom))' }}
      aria-label="Main navigation"
    >
      <ul
        className={[
          'pointer-events-auto relative mx-auto flex h-[4.25rem] max-w-lg items-end overflow-visible',
          'rounded-full border border-white/12 bg-[#121018]/78 px-1.5 pb-2 pt-1.5',
          'shadow-[0_8px_32px_rgb(0_0_0/45%),inset_0_1px_0_rgb(255_255_255/8%)]',
          'backdrop-blur-2xl',
        ].join(' ')}
      >
        {navigationItems.map(({ path, label, icon: Icon }) => {
          const isCenter = path === ROUTES.shop

          return (
            <li key={path} className="flex flex-1 justify-center">
              <NavLink
                to={path}
                end={path === '/'}
                className="relative flex w-full flex-col items-center justify-end gap-0.5"
              >
                {({ isActive }) =>
                  isCenter ? (
                    <>
                      <span
                        className={[
                          'absolute bottom-[1.35rem] flex size-[3.65rem] items-center justify-center',
                          'rounded-full bg-gradient-to-b from-[#b56bff] to-[#8b3dff]',
                          'shadow-[0_0_28px_rgb(168_85_247/70%),0_4px_14px_rgb(124_58_237/55%)]',
                          'ring-1 ring-white/20',
                          isActive ? 'scale-105' : '',
                        ].join(' ')}
                      >
                        <Icon size={26} strokeWidth={2.25} className="text-white" aria-hidden />
                      </span>
                      <span className="text-[11px] font-semibold text-white">{label}</span>
                    </>
                  ) : (
                    <>
                      <span
                        className={[
                          'flex size-9 items-center justify-center transition-colors duration-200',
                          isActive ? 'text-white' : 'text-white/70',
                        ].join(' ')}
                      >
                        <Icon size={22} strokeWidth={isActive ? 2.35 : 2} aria-hidden />
                      </span>
                      <span
                        className={[
                          'text-[11px] font-medium transition-colors duration-200',
                          isActive ? 'text-white' : 'text-white/70',
                        ].join(' ')}
                      >
                        {label}
                      </span>
                    </>
                  )
                }
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
