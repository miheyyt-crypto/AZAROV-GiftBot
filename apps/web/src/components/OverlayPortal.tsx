import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Render overlays on `document.body` so blur never composites through `.shell`. */
export function OverlayPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined" || !document.body) {
    return children;
  }
  return createPortal(children, document.body);
}
