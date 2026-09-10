import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { PartnerTaskModal } from '@/components/PartnerTaskModal'
import { getPartnerById } from '@/data/partners'
import { useUserAccount } from '@/hooks/useUserAccount'
import {
  loadMyPartnerSubmissionsResult,
  resolvePartnerTaskStatus,
  shouldShowWelvuraEntryPopup,
} from '@/lib/partners'
import type { PartnerSubmission } from '@/types/partner'

/** Replace `public/welvura-popup.png` and redeploy — build id busts WebView cache. */
const WELVURA_POPUP_IMAGE_SRC = `/welvura-popup.png?v=${
  import.meta.env.VITE_ASSET_BUILD_ID || 'dev'
}`

const WELVURA_PARTNER_ID = 'dragonmoney'

type LoadPhase = 'loading' | 'ready' | 'error'

/**
 * Entry ad for the first Welvura (dragonmoney) partner task.
 * Reads existing claimedTaskIds + submissions only — does not mutate task status.
 */
export function WelvuraPopup() {
  const account = useUserAccount()
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [submission, setSubmission] = useState<PartnerSubmission | null>(null)
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [partnerModalOpen, setPartnerModalOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const closingRef = useRef(false)

  const partner = useMemo(() => getPartnerById(WELVURA_PARTNER_ID), [])
  const firstTask = partner?.tasks[0] ?? null

  useEffect(() => {
    if (!partner || !firstTask || account.telegramId <= 0) {
      return
    }

    let cancelled = false
    setPhase('loading')

    void loadMyPartnerSubmissionsResult().then((result) => {
      if (cancelled) {
        return
      }
      if (!result.ok) {
        setPhase('error')
        setSubmission(null)
        return
      }
      setSubmission(result.byTaskId[firstTask.id] ?? null)
      setPhase('ready')
    })

    return () => {
      cancelled = true
    }
  }, [account.telegramId, firstTask, partner])

  const taskStatus = useMemo(() => {
    if (!firstTask || phase !== 'ready') {
      return null
    }
    return resolvePartnerTaskStatus(
      0,
      firstTask.id,
      account.claimedTaskIds,
      account.startedPartnerTasks ?? [],
      undefined,
      submission,
    )
  }, [
    account.claimedTaskIds,
    account.startedPartnerTasks,
    firstTask,
    phase,
    submission,
  ])

  const shouldShow =
    phase === 'ready' &&
    taskStatus !== null &&
    shouldShowWelvuraEntryPopup(taskStatus) &&
    !dismissed &&
    !partnerModalOpen

  useEffect(() => {
    if (!shouldShow) {
      setOpen(false)
      setVisible(false)
      return
    }
    setOpen(true)
  }, [shouldShow])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    closingRef.current = false
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const previousOverflow = document.body.style.overflow
    const previousTouchAction = document.body.style.touchAction
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.touchAction = 'none'
    document.body.style.overscrollBehavior = 'none'

    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      document.body.style.touchAction = previousTouchAction
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [open])

  function closePopupOnly() {
    if (closingRef.current) {
      return
    }
    closingRef.current = true
    setDismissed(true)
    setVisible(false)
    window.setTimeout(() => {
      setOpen(false)
      closingRef.current = false
    }, 200)
  }

  function openFirstWelvuraTask() {
    if (!partner) {
      return
    }
    setDismissed(true)
    setVisible(false)
    setOpen(false)
    setPartnerModalOpen(true)
  }

  if (!partner || !firstTask) {
    return null
  }

  return (
    <>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center px-4"
              style={{
                paddingTop: 'max(1rem, var(--safe-area-top, 0px))',
                paddingBottom: 'max(1rem, var(--safe-area-bottom, 0px))',
              }}
              role="presentation"
            >
              <div
                className={[
                  'absolute inset-0 bg-black/75 transition-opacity duration-200',
                  'supports-[backdrop-filter]:bg-black/55',
                  visible ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
                style={{
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                }}
                aria-hidden
              />
              {/* Blocks interaction under popup; does not dismiss (only ✕ does). */}
              <div className="press-none absolute inset-0" aria-hidden />

              <div
                role="dialog"
                aria-modal="true"
                aria-label="Welvura"
                className={[
                  'relative z-10 aspect-square overflow-hidden rounded-[24px] border border-[#c47a3a]/45',
                  'bg-[#121014] shadow-[0_20px_60px_rgb(0_0_0/55%)]',
                  'transition-all duration-200',
                  visible
                    ? 'translate-y-0 scale-100 opacity-100'
                    : 'translate-y-3 scale-95 opacity-0',
                ].join(' ')}
                style={{
                  width:
                    'min(22rem, calc(100vw - 2rem), calc(100dvh - 2rem - var(--safe-area-top, 0px) - var(--safe-area-bottom, 0px)))',
                }}
              >
                <button
                  type="button"
                  onClick={closePopupOnly}
                  className="absolute top-2.5 right-2.5 z-20 flex size-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white shadow-[0_4px_16px_rgb(0_0_0/40%)] backdrop-blur-sm"
                  aria-label="Закрыть"
                >
                  <X size={18} />
                </button>

                <button
                  type="button"
                  onClick={openFirstWelvuraTask}
                  className="absolute inset-0 z-10 block size-full overflow-hidden p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c47a3a]"
                  aria-label="Открыть первое задание Welvura"
                >
                  <img
                    src={WELVURA_POPUP_IMAGE_SRC}
                    alt="Welvura"
                    className="size-full object-cover"
                    draggable={false}
                  />
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}

      {partnerModalOpen ? (
        <PartnerTaskModal partner={partner} onClose={() => setPartnerModalOpen(false)} />
      ) : null}
    </>
  )
}
