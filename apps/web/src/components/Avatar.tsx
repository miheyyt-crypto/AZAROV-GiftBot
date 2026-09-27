import { useState } from "react";
import { httpsAvatarSrc } from "../lib/https-url.js";

export function Avatar({
  name,
  src,
  size = 32,
}: {
  name: string;
  src?: string | null | undefined;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  const safeSrc = httpsAvatarSrc(src);
  if (safeSrc && !failed) {
    return (
      <img
        className="avatar"
        src={safeSrc}
        alt=""
        width={size}
        height={size}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => {
          setFailed(true);
        }}
      />
    );
  }
  return (
    <span className="avatar" aria-hidden="true">
      {initial}
    </span>
  );
}
