import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NotificationProvider } from '@/components/NotificationProvider'
import { armBootSplashWatchdog } from '@/lib/boot-splash'
import { startColdStartPreload, startDeferredGamePreload } from '@/lib/boot-preload'
import { captureStartParam } from '@/lib/startParam'
import { bootstrapViewportEnvironment, getTelegramWebApp, installDesktopRootWheelBridge } from '@/lib/telegram'
import '@/index.css'

// Persist Telegram start_param before React mounts / WebApp.ready().
captureStartParam()
armBootSplashWatchdog()
startColdStartPreload()
bootstrapViewportEnvironment(getTelegramWebApp())
installDesktopRootWheelBridge()
if (typeof window !== 'undefined') {
  // Re-toggle desktop class only — height is CSS 100dvh (no pixel thrash / scroll reset).
  const resync = () => bootstrapViewportEnvironment(getTelegramWebApp())
  window.addEventListener('resize', resync)
  window.visualViewport?.addEventListener('resize', resync)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)

// After first visual commit: double-rAF, then warm Roll / Mines / Tower (module singleton).
if (typeof window !== 'undefined') {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      startDeferredGamePreload()
    })
  })
}
