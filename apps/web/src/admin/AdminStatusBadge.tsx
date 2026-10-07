export function adminStatusTone(
  status: string,
): "pending" | "processing" | "ok" | "danger" | "done" | "draft" {
  const value = status.toLowerCase();
  if (value === "pending" || value === "draft" || value === "queued") {
    return value === "draft" ? "draft" : "pending";
  }
  if (
    value === "processing" ||
    value === "open" ||
    value === "drawing" ||
    value === "closed" ||
    value === "playing"
  ) {
    return "processing";
  }
  if (
    value === "approved" ||
    value === "fulfilled" ||
    value === "active" ||
    value === "delivered"
  ) {
    return "ok";
  }
  if (value === "rejected" || value === "cancelled" || value === "error" || value === "failed" || value === "completed_with_errors") {
    return "danger";
  }
  if (
    value === "completed" ||
    value === "settled" ||
    value === "inactive" ||
    value === "finished"
  ) {
    return "done";
  }
  return "draft";
}

export function AdminStatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = adminStatusTone(status);
  return (
    <span className={`admin-badge admin-badge--${tone}`}>{label ?? status}</span>
  );
}
