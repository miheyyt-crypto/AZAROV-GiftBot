import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PartnerTaskItem } from '@/components/PartnerTaskItem'
import { useUserAccount } from '@/hooks/useUserAccount'
import {
  getPartnerProgress,
  loadMyPartnerSubmissions,
  resolvePartnerTaskStatus,
  startPartnerTaskAction,
  submitPartnerTaskAction,
} from '@/lib/partners'
import { createPurchaseRequestId } from '@/lib/shop'
import type { PartnerConfig, PartnerSubmission } from '@/types/partner'

interface PartnerTaskModalProps {
  partner: PartnerConfig
  onClose: () => void
}

const tipCardStyles = {
  dragonmoney:
    'border-[#c47a3a]/40 bg-[radial-gradient(ellipse_at_12%_40%,rgb(196_122_58/22%),transparent_55%),linear-gradient(90deg,#1a120c_0%,#121014_100%)]',
  stake:
    'border-[#1ec7fc]/35 bg-[radial-gradient(ellipse_at_12%_40%,rgb(30_199_252/18%),transparent_55%),linear-gradient(90deg,#0a1822_0%,#101218_100%)]',
} as const

export function PartnerTaskModal({ partner, onClose }: PartnerTaskModalProps) {
  const account = useUserAccount()
  const [visible, setVisible] = useState(false)
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [submissionsByTask, setSubmissionsByTask] = useState<Record<string, PartnerSubmission>>(
    {},
  )
  const inFlightIds = useRef(new Set<string>())
  const submitRequestIds = useRef(new Map<string, string>())

  const completedIds = account.claimedTaskIds
  const startedIds = account.startedPartnerTasks ?? []
  const accountLinkId = partner.tasks[0]?.id
  const accountLinked = Boolean(accountLinkId && completedIds.includes(accountLinkId))

  const statuses = useMemo(
    () =>
      partner.tasks.map((task, index) =>
        resolvePartnerTaskStatus(
          index,
          task.id,
          completedIds,
          startedIds,
          partner.tasks[index - 1]?.id,
          submissionsByTask[task.id],
        ),
      ),
    [partner.tasks, completedIds, startedIds, submissionsByTask],
  )

  const { completed: completedCount, total: totalCount } = getPartnerProgress(
    partner.id,
    completedIds,
    partner.tasks.length,
  )

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true))
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    let cancelled = false

    async function refreshSubmissions() {
      const map = await loadMyPartnerSubmissions()
      if (cancelled) {
        return
      }
      const scoped: Record<string, PartnerSubmission> = {}
      for (const task of partner.tasks) {
        if (map[task.id]) {
          scoped[task.id] = map[task.id]
        }
      }
      setSubmissionsByTask(scoped)
    }

    void refreshSubmissions()
    // Admin may reject in Telegram while this modal stays open — poll for status.
    const pollTimer = window.setInterval(() => {
      void refreshSubmissions()
    }, 2500)

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void refreshSubmissions()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      document.body.style.overflow = previousOverflow
    }
  }, [partner.id, partner.tasks])

  function closeModal() {
    setVisible(false)
    window.setTimeout(onClose, 200)
  }

  async function handleOpen(taskId: string) {
    const task = partner.tasks.find((item) => item.id === taskId)
    if (!task || inFlightIds.current.has(taskId) || completedIds.includes(taskId)) {
      return
    }

    inFlightIds.current.add(taskId)
    setLoadingTaskId(taskId)
    const result = await startPartnerTaskAction(task)
    setMessages((current) => ({
      ...current,
      [taskId]: result.message ?? '',
    }))
    setLoadingTaskId(null)
    inFlightIds.current.delete(taskId)
  }

  async function handleSubmit(
    taskId: string,
    input: { partnerAccountId: string; screenshot: File },
  ) {
    if (inFlightIds.current.has(taskId) || completedIds.includes(taskId)) {
      return
    }

    if (submissionsByTask[taskId]?.status === 'pending') {
      return
    }

    inFlightIds.current.add(taskId)
    setLoadingTaskId(taskId)

    let requestId = submitRequestIds.current.get(taskId)
    if (!requestId) {
      requestId = createPurchaseRequestId()
      submitRequestIds.current.set(taskId, requestId)
    }

    const result = await submitPartnerTaskAction({
      taskId,
      partnerAccountId: input.partnerAccountId,
      screenshot: input.screenshot,
      requestId,
    })

    if (result.success && result.submission) {
      submitRequestIds.current.delete(taskId)
      setSubmissionsByTask((current) => ({
        ...current,
        [taskId]: result.submission!,
      }))
    }

    setMessages((current) => ({
      ...current,
      [taskId]: result.message ?? '',
    }))
    setLoadingTaskId(null)
    inFlightIds.current.delete(taskId)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <button
        type="button"
        className={[
          'press-none ui-overlay absolute inset-0 transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-label="Закрыть"
        onClick={closeModal}
      />

      <section
        className={[
          'relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden ui-sheet transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        ].join(' ')}
        style={{ paddingBottom: 'calc(1rem + var(--safe-area-bottom))' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="partner-modal-title"
      >
        <div className="flex justify-center pt-3">
          <span className="h-1.5 w-12 rounded-full bg-white/20" />
        </div>

        <header className="flex items-center justify-between gap-3 px-5 pt-3 pb-1">
          <h2 id="partner-modal-title" className="text-[22px] font-bold tracking-tight text-white">
            {partner.name}
          </h2>
          <button
            type="button"
            onClick={closeModal}
            className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </header>

        <div className="mt-3 px-5">
          <div
            className={[
              'flex items-start gap-3 rounded-[20px] border p-3.5',
              tipCardStyles[partner.theme],
            ].join(' ')}
          >
            <div
              className={[
                'flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/30',
                partner.theme === 'stake' ? 'p-2.5' : 'p-1',
              ].join(' ')}
            >
              {partner.logoImage ? (
                <img
                  src={partner.logoImage}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                  aria-hidden
                />
              ) : (
                <span className="text-sm font-black text-white">
                  {partner.logo ?? partner.name.charAt(0)}
                </span>
              )}
            </div>
            <p className="pt-0.5 text-[13px] leading-relaxed text-white/80">
              {partner.modalDescription}
            </p>
          </div>

          <p className="mt-3 text-xs font-medium text-white/45">
            Выполнено {completedCount} из {totalCount}
          </p>
        </div>

        <div className="mt-3 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-5 pb-4">
          {partner.tasks.map((task, index) => (
            <PartnerTaskItem
              key={task.id}
              index={index}
              task={task}
              status={statuses[index]}
              isLoading={loadingTaskId === task.id}
              message={messages[task.id]}
              theme={partner.theme}
              accountLinked={accountLinked}
              submission={submissionsByTask[task.id]}
              onOpen={() => handleOpen(task.id)}
              onSubmit={(input) => handleSubmit(task.id, input)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
