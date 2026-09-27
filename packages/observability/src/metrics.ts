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

export function metricsBody(
  processName: string,
  metrics: Metrics,
): { process: string; counters: Record<string, number> } {
  return {
    process: processName,
    counters: metrics.snapshot(),
  };
}
