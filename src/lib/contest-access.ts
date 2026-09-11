import type { ReferralContestVisibility } from '@/types/referral-contest'

let referralContestVisible = false
let referralContestVisibility: ReferralContestVisibility | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

export function setReferralContestVisibility(value: ReferralContestVisibility | null | undefined) {
  referralContestVisibility = value || null
  referralContestVisible = Boolean(value?.visible)
  emit()
}

export function isReferralContestVisible(): boolean {
  return referralContestVisible
}

export function getReferralContestVisibilityState(): ReferralContestVisibility | null {
  return referralContestVisibility
}

export function subscribeReferralContestVisibility(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
