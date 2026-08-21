interface HomeSectionTitleProps {
  title: string
}

export function HomeSectionTitle({ title }: HomeSectionTitleProps) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-5 w-1 rounded-full bg-neon-purple" aria-hidden />
      <h2 className="text-lg font-bold text-white">{title}</h2>
    </div>
  )
}
