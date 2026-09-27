export const HTTPS_AVATAR_URL_MAX_LENGTH = 2048;

export function normalizeHttpsAvatarUrl(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > HTTPS_AVATAR_URL_MAX_LENGTH) {
    return null;
  }
  for (const ch of trimmed) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) {
      return null;
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  if (!parsed.hostname) {
    return null;
  }
  return parsed.toString();
}

export function publicAvatarUrl(raw: string | null | undefined): string | null {
  return normalizeHttpsAvatarUrl(raw);
}
