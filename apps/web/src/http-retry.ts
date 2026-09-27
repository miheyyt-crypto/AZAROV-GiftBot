/** GET retry delays: 250–500ms, then exponential, plus jitter. */

export const GET_RETRY_ATTEMPTS = 2;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function retryDelayMs(
  attemptIndex: number,
  random: () => number = Math.random,
): number {
  const base = 250 * 2 ** attemptIndex;
  return base + Math.floor(random() * (base + 1));
}

export function shouldRetryGetStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function isIdempotentRead(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "GET" || upper === "HEAD";
}

export function retryAfterMs(
  retryAfterHeader: string | null,
  attemptIndex: number,
  random: () => number = Math.random,
): number {
  const parsed =
    retryAfterHeader && /^\d+$/.test(retryAfterHeader.trim())
      ? Number(retryAfterHeader.trim()) * 1000
      : 0;
  const base = parsed > 0 ? Math.min(parsed, 5_000) : retryDelayMs(attemptIndex, () => 0);
  return base + Math.floor(random() * 250);
}
