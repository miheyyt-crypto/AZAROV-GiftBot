/** In-process TTL cache with promise single-flight. Not for user-private data. */
export function createTtlCache<T>(ttlMs: number): {
  invalidate: () => void;
  get: (load: () => Promise<T>) => Promise<T>;
} {
  let value: { at: number; data: T } | null = null;
  let inflight: Promise<T> | null = null;
  return {
    invalidate() {
      value = null;
      inflight = null;
    },
    async get(load) {
      const now = Date.now();
      if (value && now - value.at < ttlMs) {
        return value.data;
      }
      if (inflight) {
        return inflight;
      }
      inflight = load()
        .then((data) => {
          value = { at: Date.now(), data };
          return data;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}
