interface HomeSectionTitleProps {
  title: string
}

export function HomeSectionTitle({ title }: HomeSectionTitleProps) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-4 w-0.5 rounded-full bg-neon-purple/80" aria-hidden />
      <h2 className="ui-section-title">{title}</h2>
    </div>
  )
}
