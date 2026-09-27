import { useRef } from "react";

const ACCEPT = "image/jpeg,image/png,image/webp";

export function AdminImageField({
  previewUrl,
  disabled = false,
  onFile,
  onClear,
}: {
  previewUrl: string | null;
  disabled?: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(file: File | undefined): void {
    if (!file) {
      return;
    }
    onFile(file);
  }

  return (
    <div className="admin-upload">
      <input
        ref={inputRef}
        className="admin-upload__input"
        type="file"
        accept={ACCEPT}
        disabled={disabled}
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {previewUrl ? (
        <div className="admin-upload__preview">
          <img src={previewUrl} alt="" />
          <div className="admin-upload__actions">
            <button
              type="button"
              className="admin-btn admin-btn--secondary"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              Заменить
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={disabled}
              onClick={onClear}
            >
              Удалить
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="admin-upload__drop"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            pick(event.dataTransfer.files[0]);
          }}
        >
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
            <rect
              x="3"
              y="5"
              width="18"
              height="14"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <circle cx="9" cy="10" r="1.6" fill="currentColor" />
            <path
              d="M21 16.5 16 12l-4.5 4.5L9 14.2 3 19"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
          <span>Загрузить изображение</span>
          <small>PNG, JPG, WEBP · до 5 МБ</small>
        </button>
      )}
    </div>
  );
}
