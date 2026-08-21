export interface TelegramWebAppUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  language_code?: string
  is_premium?: boolean
}

export interface TelegramThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
}

export interface TelegramWebApp {
  ready: () => void
  expand: () => void
  close: () => void
  initData: string
  initDataUnsafe: {
    user?: TelegramWebAppUser
    query_id?: string
    auth_date?: number
    hash?: string
    start_param?: string
  }
  colorScheme: 'light' | 'dark'
  themeParams: TelegramThemeParams
  isExpanded: boolean
  viewportHeight: number
  viewportStableHeight: number
  platform: string
  version: string
  openTelegramLink?: (url: string) => void
  openLink?: (url: string) => void
}

export interface TelegramGlobal {
  WebApp: TelegramWebApp
}

declare global {
  interface Window {
    Telegram?: TelegramGlobal
  }
}
