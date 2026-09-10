/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_TELEGRAM_BOT_USERNAME?: string
  /** Injected at build time for public asset cache-busting. */
  readonly VITE_ASSET_BUILD_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
