import { useTelegramWebApp } from '@/hooks/useTelegramWebApp'
import { useUserAccount } from '@/hooks/useUserAccount'

export function useAppSession() {
  const telegram = useTelegramWebApp()
  const account = useUserAccount()

  return {
    ...telegram,
    account,
  }
}
