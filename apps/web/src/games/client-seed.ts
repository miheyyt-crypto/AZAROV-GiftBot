const CLIENT_SEED_KEY = "giftbot.pf.clientSeed";

export function getOrCreateClientSeed(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_SEED_KEY);
    if (existing && existing.length > 0 && existing.length <= 128) {
      return existing;
    }
  } catch {
    /* ignore */
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const seed = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  try {
    window.localStorage.setItem(CLIENT_SEED_KEY, seed);
  } catch {
    /* ignore */
  }
  return seed;
}

export function setClientSeed(seed: string): void {
  const trimmed = seed.trim().slice(0, 128);
  try {
    window.localStorage.setItem(CLIENT_SEED_KEY, trimmed);
  } catch {
    /* ignore */
  }
}
