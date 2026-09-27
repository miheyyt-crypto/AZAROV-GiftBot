import type { ReactNode } from "react";
import { Skeleton } from "../ui/Skeleton.js";

export function QueryPanel({
  status,
  errorMessage,
  onRetry,
  loadingLabel,
  children,
}: {
  status: "loading" | "error" | "ready";
  errorMessage?: string;
  onRetry: () => void;
  loadingLabel: string;
  children?: ReactNode;
}) {
  if (status === "loading") {
    return <Skeleton label={loadingLabel} />;
  }
  if (status === "error") {
    return (
      <section className="card motion-state">
        <p className="muted">{errorMessage ?? "Не удалось загрузить данные."}</p>
        <button type="button" className="retry" onClick={onRetry}>
          Повторить
        </button>
      </section>
    );
  }
  return <>{children}</>;
}