import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NotificationProvider } from '@/components/NotificationProvider'
import { captureStartParam } from '@/lib/startParam'
import '@/index.css'

// Persist Telegram start_param before React mounts / WebApp.ready().
captureStartParam()

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
