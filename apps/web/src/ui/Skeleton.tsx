export function Skeleton({
  label,
  lines = 3,
}: {
  label: string;
  lines?: number;
}) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <div className="skeleton-line" key={index} />
      ))}
    </div>
  );
}
