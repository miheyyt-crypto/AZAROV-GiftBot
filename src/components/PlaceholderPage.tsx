import type { ReactNode } from 'react'

interface PlaceholderPageProps {
  title: string
  description: string
  children?: ReactNode
}

export function PlaceholderPage({
  title,
  description,
  children,
}: PlaceholderPageProps) {
  return (
    <section className="flex min-h-full flex-col px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        <p className="mt-2 text-sm text-muted">{description}</p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-white/5 bg-bg-elevated p-8 text-center">
        <p className="text-sm text-muted">
          Placeholder — content will be added in the next stages.
        </p>
        {children}
      </div>
    </section>
  )
}
