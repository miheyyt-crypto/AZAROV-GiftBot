export function ProgressBar({
  value,
  max,
  tone = "purple",
}: {
  value: number;
  max: number;
  tone?: "purple" | "gold";
}) {
  const percent = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      className={tone === "gold" ? "progress progress--gold" : "progress"}
      aria-valuenow={value}
      aria-valuemax={max}
      role="progressbar"
    >
      <span style={{ width: `${String(percent)}%` }} />
    </div>
  );
}
