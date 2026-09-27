const HTTPS_AVATAR_URL_MAX_LENGTH = 2048;

export function httpsAvatarSrc(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > HTTPS_AVATAR_URL_MAX_LENGTH) {
    return undefined;
  }
  if (!/^https:\/\//i.test(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}
