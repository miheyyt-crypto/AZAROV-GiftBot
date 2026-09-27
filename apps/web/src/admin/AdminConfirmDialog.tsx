import { OverlayPortal } from "../components/OverlayPortal.js";

export function AdminConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) {
    return null;
  }
  return (
    <OverlayPortal>
      <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
        <div className="admin-modal__backdrop" aria-hidden="true" />
        <div className="admin-modal__card">
          <h2 id="admin-confirm-title">{title}</h2>
          <p>{body}</p>
          <div className="admin-modal__actions">
            <button type="button" className="admin-btn admin-btn--ghost" onClick={onCancel}>
              Отмена
            </button>
            <button
              type="button"
              className={danger ? "admin-btn admin-btn--danger" : "admin-btn admin-btn--primary"}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
