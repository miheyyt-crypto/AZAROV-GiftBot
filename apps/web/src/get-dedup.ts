/** In-flight coalescing for identical GET. Response TTL only via allowlist. */

type Entry<T> = { at: number; value: T };

const inflight = new Map<string, Promise<unknown>>();
const ttl = new Map<string, Entry<unknown>>();

/** Shared catalogs / boards only. Mutable per-user GETs must not appear here. */
const GET_RESPONSE_TTL_MS: ReadonlyArray<{ path: string; ttlMs: number }> = [
  { path: "/shop/catalog", ttlMs: 30_000 },
  { path: "/cases/paid", ttlMs: 30_000 },
  { path: "/cases/referral", ttlMs: 30_000 },
  { path: "/leaderboard/balance", ttlMs: 8_000 },
  { path: "/leaderboard/referrals", ttlMs: 8_000 },
  { path: "/contest/referral/summary", ttlMs: 8_000 },
];

export function getDedupKey(token: string, path: string): string {
  return `${token} ${path}`;
}

export function ttlMsForGetPath(path: string): number | undefined {
  const pathname = (path.split("?")[0] ?? path).replace(/\/$/, "") || "/";
  const row = GET_RESPONSE_TTL_MS.find((entry) => entry.path === pathname);
  return row?.ttlMs;
}

export function clearGetDedupForTests(): void {
  inflight.clear();
  ttl.clear();
}

export async function dedupeGet<T>(
  token: string,
  path: string,
  load: () => Promise<T>,
  now = Date.now(),
): Promise<T> {
  const key = getDedupKey(token, path);
  const ttlMs = ttlMsForGetPath(path);
  if (ttlMs !== undefined) {
    const cached = ttl.get(key) as Entry<T> | undefined;
    if (cached && now - cached.at < ttlMs) {
      return cached.value;
    }
  }
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) {
    return pending;
  }
  const promise = load()
    .then((value) => {
      if (ttlMs !== undefined) {
        ttl.set(key, { at: Date.now(), value });
      }
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === promise) {
        inflight.delete(key);
      }
    });
  inflight.set(key, promise);
  return promise;
}

export function invalidateGetDedup(token: string, path: string): void {
  const key = getDedupKey(token, path);
  ttl.delete(key);
  inflight.delete(key);
}
