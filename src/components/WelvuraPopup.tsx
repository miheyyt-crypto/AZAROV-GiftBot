import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { PartnerTaskModal } from '@/components/PartnerTaskModal'
import { useAuth } from '@/components/AuthGate'
import { getPartnerById } from '@/data/partners'
import { useUserAccount } from '@/hooks/useUserAccount'
import {
  loadMyPartnerSubmissionsResult,
  resolvePartnerTaskStatus,
  shouldShowWelvuraEntryPopup,
} from '@/lib/partners'
import type { PartnerSubmission } from '@/types/partner'

/** Replace `public/welvura-popup.webp` and redeploy — build id busts WebView cache. */
const WELVURA_POPUP_IMAGE_SRC = `/welvura-popup.webp?v=${
  import.meta.env.VITE_ASSET_BUILD_ID || 'dev'
}`

const WELVURA_PARTNER_ID = 'dragonmoney'

type LoadPhase = 'loading' | 'ready' | 'error'

/**
 * Entry ad for the first Welvura (dragonmoney) partner task.
 * Reads existing claimedTaskIds + submissions only — does not mutate task status.
 */
export function WelvuraPopup() {
  const { sessionReady } = useAuth()
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
    if (!sessionReady || !partner || !firstTask || account.telegramId <= 0) {
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
  }, [account.telegramId, firstTask, partner, sessionReady])

  const taskStatus = useMemo(() => {
    if (!sessionReady || !firstTask || phase !== 'ready') {
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
    sessionReady,
    submission,
  ])

  const shouldShow =
    sessionReady &&
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
              className="fixed inset-0 z-[90] flex items-center justify-center"
              style={{
                // Symmetric insets keep banner+CTA optically centered; room for ✕ above.
                paddingTop: 'max(3.25rem, calc(var(--safe-area-top, 0px) + 0.75rem))',
                paddingBottom: 'max(3.25rem, calc(var(--safe-area-bottom, 0px) + 0.75rem))',
                paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
                paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
              }}
              role="presentation"
            >
              {/* Backdrop: dim + blur + soft ambient tint (never blurs the popup). */}
              <div
                className={[
                  'absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none',
                  'bg-[radial-gradient(ellipse_at_50%_42%,rgb(83_204_24/10%),transparent_58%),rgb(0_0_0/78%)]',
                  'supports-[backdrop-filter]:bg-[radial-gradient(ellipse_at_50%_42%,rgb(83_204_24/8%),transparent_58%),rgb(0_0_0/62%)]',
                  visible ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
                style={{
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                }}
                aria-hidden
              />
              {/* Blocks interaction under popup; does not dismiss (only ✕ does). */}
              <div className="press-none absolute inset-0" aria-hidden />

              {/*
                Single content column: banner + CTA share identical width & center axis.
                Close is absolute to the banner edge and does not affect layout/centering.
              */}
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Welvura"
                className={[
                  'relative z-10 box-border flex w-full max-w-[20rem] flex-col items-stretch',
                  'transition-[opacity,transform] duration-200 ease-out',
                  'motion-reduce:transition-none motion-reduce:transform-none',
                  visible ? 'scale-100 opacity-100' : 'scale-[0.96] opacity-0',
                ].join(' ')}
                style={{
                  width:
                    'min(20rem, 100%, calc(100dvh - var(--safe-area-top, 0px) - var(--safe-area-bottom, 0px) - 9.5rem))',
                }}
              >
                {/* Soft ambient green glow — centered on the column, not the viewport. */}
                <div
                  className={[
                    'pointer-events-none absolute top-[22%] left-1/2 -z-10 h-[62%] w-[112%] -translate-x-1/2 rounded-full',
                    'bg-[radial-gradient(ellipse_at_center,rgb(83_204_24/26%),transparent_68%)] blur-2xl',
                    'transition-opacity duration-200 motion-reduce:transition-none',
                    visible ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                  aria-hidden
                />

                <div className="relative w-full shrink-0">
                  <button
                    type="button"
                    onClick={closePopupOnly}
                    className={[
                      'press-none absolute top-0 right-0 z-20 flex size-10 -translate-y-[calc(100%+10px)] items-center justify-center',
                      'rounded-full border border-white/18 bg-white/12 text-white/95',
                      'shadow-[0_6px_20px_rgb(0_0_0/35%)] backdrop-blur-md',
                      'transition-transform duration-150 ease-out',
                      'active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-kick/60',
                    ].join(' ')}
                    aria-label="Закрыть"
                  >
                    <X size={17} strokeWidth={2.25} />
                  </button>

                  <button
                    type="button"
                    onClick={openFirstWelvuraTask}
                    className={[
                      'press-none relative box-border aspect-square w-full overflow-hidden rounded-[26px] p-0',
                      'border border-white/12 bg-[#0d120e]',
                      'shadow-[0_22px_48px_rgb(0_0_0/55%),0_0_0_1px_rgb(83_204_24/12%),0_0_42px_rgb(83_204_24/16%)]',
                      'transition-transform duration-150 ease-out',
                      'active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-kick/55',
                    ].join(' ')}
                    aria-label="Открыть первое задание Welvura"
                  >
                    <img
                      src={WELVURA_POPUP_IMAGE_SRC}
                      alt="Welvura"
                      className="size-full object-cover"
                      draggable={false}
                      decoding="async"
                      fetchPriority="high"
                    />
                    <span
                      className="pointer-events-none absolute inset-0 rounded-[26px] ring-1 ring-inset ring-white/10"
                      aria-hidden
                    />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={openFirstWelvuraTask}
                  className={[
                    'press-none mt-2.5 box-border flex min-h-12 w-full shrink-0 items-center justify-center rounded-[16px]',
                    'border border-[#c8ff6a]/50 bg-gradient-to-b from-[#b8ff3d] to-[#7dff1a]',
                    'text-[15px] font-bold tracking-[0.06em] text-white',
                    'shadow-[0_10px_28px_rgb(0_0_0/35%),0_0_28px_rgb(170_255_40/40%)]',
                    'transition-[transform,box-shadow] duration-150 ease-out',
                    'active:scale-[0.97] active:shadow-[0_6px_18px_rgb(0_0_0/30%),0_0_22px_rgb(170_255_40/50%)]',
                    'motion-reduce:transition-none motion-reduce:active:scale-100',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b8ff3d]/80',
                  ].join(' ')}
                >
                  ПРИВЯЗАТЬ
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
