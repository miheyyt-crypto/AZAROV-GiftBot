interface MaintenanceScreenProps {
  message?: string
}

export function MaintenanceScreen({
  message = 'Ведутся тех. работы',
}: MaintenanceScreenProps) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-bg-dark px-6 text-center">
      <div className="max-w-sm">
        <p className="text-5xl" aria-hidden>
          🛠
        </p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">{message}</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/55">
          Mini App временно закрыт на обслуживание. Загляни чуть позже.
        </p>
      </div>
    </div>
  )
}
