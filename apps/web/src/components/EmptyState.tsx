export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="muted">{text}</p>
    </div>
  );
}
