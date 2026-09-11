import { createPortal } from 'react-dom'
import { NavLink } from 'react-router-dom'

import { navigationItems } from '@/data/navigation'
import { ROUTES } from '@/lib/constants'

export function BottomNav() {
  return createPortal(
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] px-3"
      style={{ paddingBottom: 'calc(0.7rem + var(--safe-area-bottom))' }}
      aria-label="Main navigation"
    >
      {/* Opaque chrome so page scroll/padding never paints over or through the nav. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-[1] h-[calc(100%+1.25rem)] bg-gradient-to-t from-[#0b0912] from-40% via-[#0b0912]/92 to-transparent"
        aria-hidden
      />

      <ul
        className={[
          'pointer-events-auto relative mx-auto flex h-[4.25rem] max-w-lg items-end overflow-visible',
          'rounded-full border border-white/[0.08] bg-[#11101a]/92 px-1.5 pb-2 pt-1.5',
          'shadow-[0_10px_32px_rgb(0_0_0/40%),inset_0_1px_0_rgb(255_255_255/6%)]',
          'backdrop-blur-xl',
        ].join(' ')}
      >
        {navigationItems.map(({ path, label, icon: Icon }) => {
          const isCenter = path === ROUTES.shop

          return (
            <li key={path} className="flex flex-1 justify-center">
              <NavLink
                to={path}
                end={path === '/'}
                className="relative flex min-h-11 w-full flex-col items-center justify-end gap-0.5"
              >
                {({ isActive }) =>
                  isCenter ? (
                    <>
                      <span
                        className={[
                          'absolute bottom-[1.35rem] flex size-14 items-center justify-center',
                          'rounded-full bg-gradient-to-b from-neon-purple to-purple',
                          'shadow-[var(--glow-cta)] ring-1 ring-white/15',
                          isActive ? 'ring-2 ring-white/25' : '',
                        ].join(' ')}
                      >
                        <Icon size={24} strokeWidth={2.2} className="text-white" aria-hidden />
                      </span>
                      <span
                        className={[
                          'text-[11px] font-medium',
                          isActive ? 'text-white' : 'text-text-secondary',
                        ].join(' ')}
                      >
                        {label}
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        className={[
                          'flex size-9 items-center justify-center transition-colors duration-200',
                          isActive ? 'text-white' : 'text-muted',
                        ].join(' ')}
                      >
                        <Icon size={22} strokeWidth={isActive ? 2.25 : 1.9} aria-hidden />
                      </span>
                      <span
                        className={[
                          'text-[11px] font-medium transition-colors duration-200',
                          isActive ? 'text-white' : 'text-muted',
                        ].join(' ')}
                      >
                        {label}
                      </span>
                      {isActive ? (
                        <span
                          className="absolute -top-0.5 h-0.5 w-4 rounded-full bg-neon-purple/80"
                          aria-hidden
                        />
                      ) : null}
                    </>
                  )
                }
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>,
    document.body,
  )
}
