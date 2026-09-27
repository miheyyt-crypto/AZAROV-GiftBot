import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { CloseButton } from "./CloseButton.js";
import { OverlayPortal } from "./OverlayPortal.js";

const SHEET_CLOSE_MS = 380;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function BottomSheet({
  open,
  title,
  onClose,
  children,
  subtitle,
  headRight,
  className,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  subtitle?: string;
  headRight?: ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setVisible(true);
      return;
    }
    if (!visible) {
      return;
    }
    if (prefersReducedMotion()) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(false), SHEET_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, visible]);

  useEffect(() => {
    if (!open && !visible) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, visible, onClose]);

  if (!open && !visible) {
    return null;
  }

  const closing = !open;
  const sheetClass = ["sheet", className, closing ? "is-closing" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <OverlayPortal>
      <div className={sheetClass} role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="sheet__backdrop" onClick={onClose} aria-label="Закрыть" />
        <div className="sheet__panel">
          <div className="sheet__grab" />
          <div className="sheet__head">
            <div className="sheet__titles">
              <h2>{title}</h2>
              {subtitle ? <p className="sheet__subtitle">{subtitle}</p> : null}
            </div>
            <div className="sheet__head-actions">
              {headRight}
              <CloseButton onClick={onClose} ariaLabel="Закрыть" size="sheet" />
            </div>
          </div>
          <div className="sheet__body">{children}</div>
        </div>
      </div>
    </OverlayPortal>
  );
}
