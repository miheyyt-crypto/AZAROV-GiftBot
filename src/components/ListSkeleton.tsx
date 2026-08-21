interface ListSkeletonProps {
  rows?: number
}

export function ListSkeleton({ rows = 4 }: ListSkeletonProps) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-[20px] border border-white/8 bg-white/[0.04] p-4"
        >
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-white/10" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-[66%] rounded bg-white/10" />
              <div className="h-3 w-[48%] rounded bg-white/8" />
            </div>
            <div className="h-3 w-14 rounded bg-white/8" />
          </div>
        </div>
      ))}
    </div>
  )
}
