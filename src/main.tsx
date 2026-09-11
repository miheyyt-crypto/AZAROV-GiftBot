import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NotificationProvider } from '@/components/NotificationProvider'
import { armBootSplashWatchdog } from '@/lib/boot-splash'
import { captureStartParam } from '@/lib/startParam'
import { bootstrapViewportEnvironment, getTelegramWebApp } from '@/lib/telegram'
import { installDesktopScrollTrace } from '@/lib/roll-scroll-debug'
import '@/index.css'

// Persist Telegram start_param before React mounts / WebApp.ready().
captureStartParam()
armBootSplashWatchdog()
// Desktop scroll-root before first paint (TG Desktop iframe clips document scroll).
bootstrapViewportEnvironment(getTelegramWebApp())
installDesktopScrollTrace()
if (typeof window !== 'undefined') {
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
