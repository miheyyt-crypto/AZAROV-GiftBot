import { Component, type ErrorInfo, type ReactNode } from 'react'

import { getUserFacingError, logAppError } from '@/lib/errors'
import { signalAppBootReady } from '@/lib/boot-splash'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error.message, error.stack, info.componentStack)
    logAppError(getUserFacingError(error), `ErrorBoundary:${info.componentStack ?? ''}`)
    // Never leave the branded splash covering a fatal error screen.
    signalAppBootReady()
  }

  private handleRestart = () => {
    this.setState({ hasError: false })
    window.location.assign('/')
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-full items-center justify-center bg-bg-dark px-6 py-16">
          <div className="w-full max-w-sm rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-center">
            <p className="text-3xl" aria-hidden>
              ⚠️
            </p>
            <h1 className="mt-4 text-xl font-bold text-white">Что-то пошло не так</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Приложение столкнулось с неожиданной ошибкой.
            </p>
            <button
              type="button"
              onClick={this.handleRestart}
              className="mt-6 w-full rounded-2xl bg-[#9b4dff] px-4 py-3 text-sm font-semibold text-white shadow-[0_0_18px_rgb(155_77_255/40%)]"
            >
              Перезапустить
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
