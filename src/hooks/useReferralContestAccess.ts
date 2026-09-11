import { useSyncExternalStore } from 'react'

import {
  getReferralContestVisibilityState,
  isReferralContestVisible,
  subscribeReferralContestVisibility,
} from '@/lib/contest-access'
import type { ReferralContestVisibility } from '@/types/referral-contest'

export function useReferralContestVisible(): boolean {
  return useSyncExternalStore(
    subscribeReferralContestVisibility,
    isReferralContestVisible,
    () => false,
  )
}

export function useReferralContestVisibility(): ReferralContestVisibility | null {
  return useSyncExternalStore(
    subscribeReferralContestVisibility,
    getReferralContestVisibilityState,
    () => null,
  )
}
