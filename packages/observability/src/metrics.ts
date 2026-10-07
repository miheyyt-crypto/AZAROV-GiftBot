export const METRIC_NAMES = {
  httpRequests: "http_requests",
  jobsCompleted: "jobs_completed",
  jobsFailed: "jobs_failed",
  reconcileMismatch: "reconcile_mismatch",
  http5xx: "http_5xx",
  http429: "http_429",
} as const;

export type Metrics = {
  increment: (name: string, by?: number) => void;
  snapshot: () => Record<string, number>;
};

export function createMetrics(): Metrics {
  const counters = new Map<string, number>();
  return {
    increment(name, by = 1) {
      counters.set(name, (counters.get(name) ?? 0) + by);
    },
    snapshot() {
      return Object.fromEntries(counters);
    },
  };
}

export type ProcessMemoryUsage = {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
};

/** process.memoryUsage() bytes. GET /metrics only — not a heap snapshot. */
export function processMemoryUsage(): ProcessMemoryUsage {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

export function metricsBody(
  processName: string,
  metrics: Metrics,
): {
  process: string;
  counters: Record<string, number>;
  memory: ProcessMemoryUsage;
} {
  return {
    process: processName,
    counters: metrics.snapshot(),
    memory: processMemoryUsage(),
  };
}
