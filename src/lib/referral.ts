import { activateReferralRemote } from '@/lib/api'
import { getCurrentAccount } from '@/lib/account'
import {
  REFERRAL_CASE_EVERY,
  REFERRAL_CODE_PREFIX,
  getTelegramLoginBotUsername,
} from '@/lib/constants'
import { getTelegramWebApp } from '@/lib/telegram'
import type { ReferralProgress } from '@/types'
import type { UserAccount } from '@/types/account'
import type { ReferralCaseStats } from '@/types/case'

export interface ReferralState {
  progress: ReferralProgress
  referralLink: string
  isCompleted: boolean
}

export function buildReferralLink(referralCode: string): string {
  const code = referralCode.replace(/^ref_/i, '').trim().toUpperCase()
  if (!code) {
    return ''
  }

  return `https://t.me/${getTelegramLoginBotUsername()}?startapp=${REFERRAL_CODE_PREFIX}${code}`
}

export function getCurrentReferralLink(): string {
  const account = getCurrentAccount()
  return account.referralLink || buildReferralLink(account.referralCode)
}

export function getStartParam(): string {
  const START_PARAM_STORAGE_KEY = 'azarov_tg_start_param'

  const fromTelegram = getTelegramWebApp()?.initDataUnsafe.start_param?.trim() || ''

  let fromUrl = ''
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    fromUrl =
      params.get('tgWebAppStartParam')?.trim() ||
      params.get('startapp')?.trim() ||
      ''

    // Telegram sometimes puts launch params in the hash.
    if (!fromUrl && window.location.hash) {
      const hash = window.location.hash.replace(/^#/, '')
      const hashParams = new URLSearchParams(hash.startsWith('?') ? hash.slice(1) : hash)
      fromUrl =
        hashParams.get('tgWebAppStartParam')?.trim() ||
        hashParams.get('startapp')?.trim() ||
        ''
    }
  }

  const found = fromTelegram || fromUrl
  if (found && typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(START_PARAM_STORAGE_KEY, found)
    } catch {
      // Ignore quota / private mode failures.
    }
    return found
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      return sessionStorage.getItem(START_PARAM_STORAGE_KEY)?.trim() || ''
    } catch {
      return ''
    }
  }

  return ''
}

export function clearStoredStartParam(): void {
  if (typeof sessionStorage === 'undefined') {
    return
  }
  try {
    sessionStorage.removeItem('azarov_tg_start_param')
  } catch {
    // ignore
  }
}

export function onKickConnected(): Promise<{ success: boolean; message?: string }> {
  return activateReferralRemote().then((result) => ({
    success: Boolean(result.success),
    message: result.message,
  }))
}

export function getReferralCaseCount(activeReferrals: number): number {
  return Math.floor(activeReferrals / REFERRAL_CASE_EVERY)
}

export function getReferralCaseStats(
  account: UserAccount = getCurrentAccount(),
): ReferralCaseStats {
  const invitedCount = Math.max(0, account.invitedCount)
  const activeCount = Math.max(0, account.activeReferrals)
  const openedReferralCases = Math.max(0, account.openedReferralCases ?? 0)
  const earnedReferralCases = getReferralCaseCount(activeCount)
  const availableReferralCases = Math.max(
    0,
    account.availableReferralCases ?? earnedReferralCases - openedReferralCases,
  )

  let currentProgress =
    typeof account.caseProgress === 'number'
      ? account.caseProgress
      : activeCount % REFERRAL_CASE_EVERY
  if (availableReferralCases > 0 && currentProgress === 0) {
    currentProgress = REFERRAL_CASE_EVERY
  }

  const progressTarget = account.caseTarget ?? REFERRAL_CASE_EVERY

  return {
    invitedCount,
    confirmedReferrals: activeCount,
    currentProgress,
    progressTarget,
    earnedReferralCases,
    openedReferralCases,
    availableReferralCases,
    remainingInvites:
      availableReferralCases > 0
        ? 0
        : currentProgress === 0
          ? progressTarget
          : progressTarget - currentProgress,
  }
}

export function getReferralStats(account: UserAccount = getCurrentAccount()) {
  const caseStats = getReferralCaseStats(account)

  return {
    ...caseStats,
    activeReferrals: caseStats.confirmedReferrals,
    referralEarnings: account.referralEarnings,
  }
}

export function getAvailableReferralCases(account: UserAccount = getCurrentAccount()): number {
  return getReferralCaseStats(account).availableReferralCases
}

export function getReferralCaseRemainingLabel(remaining: number): string {
  if (remaining <= 0) {
    return 'Получен'
  }

  if (remaining === 1) {
    return 'Остался 1 друг'
  }

  return `Осталось пригласить ${remaining} друзей`
}

export function getReferralState(account: UserAccount = getCurrentAccount()): ReferralState {
  return {
    progress: {
      current: account.activeReferrals,
      required: 3,
    },
    referralLink: buildReferralLink(account.referralCode),
    isCompleted: account.activeReferrals >= 3,
  }
}

export function isReferralComplete(progress: ReferralProgress): boolean {
  return progress.current >= progress.required
}

export function shareReferralLink(referralLink: string): Promise<'telegram' | 'native' | 'copied'> {
  const shareText = [
    '🎁 Присоединяйся к приложению и получай бонусы!',
    '',
    'Здесь можно получать монеты, выполнять задания и открывать кейсы.',
    '',
    'Моя ссылка:',
    referralLink,
  ].join('\n')
  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`
  const webApp = getTelegramWebApp()

  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(telegramShareUrl)
    return Promise.resolve('telegram')
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    return navigator
      .share({
        title: 'AZAROV — GiftBot',
        text: shareText,
        url: referralLink,
      })
      .then(() => 'native' as const)
      .catch(async () => {
        await copyText(referralLink)
        return 'copied' as const
      })
  }

  return copyText(referralLink).then(() => 'copied')
}

export async function copyText(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  if (typeof document === 'undefined') {
    return
  }

  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'absolute'
  input.style.left = '-9999px'
  document.body.appendChild(input)
  input.select()
  document.execCommand('copy')
  document.body.removeChild(input)
}
