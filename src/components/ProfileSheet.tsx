import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ProfileSheetProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export function ProfileSheet({ title, onClose, children }: ProfileSheetProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  function close() {
    setVisible(false)
    window.setTimeout(onClose, 180)
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <button
        type="button"
        className={[
          'press-none absolute inset-0 bg-black/70 transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-label="Закрыть"
        onClick={close}
      />
      <section
        className={[
          'relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[32px] border border-white/10 bg-[#1a1a1f] transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        ].join(' ')}
        style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom))' }}
      >
        <header className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={close}
            className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </header>
        <div className="mt-4 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
      </section>
    </div>,
    document.body,
  )
}
