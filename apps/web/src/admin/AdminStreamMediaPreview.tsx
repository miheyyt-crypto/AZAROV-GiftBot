import { useRef, useState } from "react";

export function AdminStreamMediaPreview({
  src,
  contentType,
  submissionId,
  placeholder = "медиа",
}: {
  src: string | null;
  contentType?: string | null;
  submissionId?: string;
  placeholder?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [listen, setListen] = useState(false);
  const previewStyle = {
    width: 96,
    height: 72,
    objectFit: "contain" as const,
    background: "transparent",
  };
  if (!src) {
    return (
      <p
        className="muted"
        {...(submissionId
          ? { "data-preview-submission-id": submissionId }
          : {})}
      >
        {placeholder}
      </p>
    );
  }
  if (!contentType?.startsWith("video/")) {
    return (
      <img
        src={src}
        alt=""
        {...(submissionId
          ? { "data-preview-submission-id": submissionId }
          : {})}
        style={previewStyle}
      />
    );
  }
  return (
    <div
      className="stack"
      {...(submissionId
        ? { "data-preview-submission-id": submissionId }
        : {})}
    >
      <video
        ref={videoRef}
        src={src}
        muted={!listen}
        playsInline
        controls={listen}
        style={previewStyle}
      />
      <button
        type="button"
        data-listen-preview={submissionId ?? "video"}
        onClick={() => {
          setListen(true);
          const el = videoRef.current;
          if (el) {
            el.muted = false;
            void el.play().catch(() => undefined);
          }
        }}
      >
        Прослушать
      </button>
    </div>
  );
}
