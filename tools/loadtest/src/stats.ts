export const USER_LADDER = [15, 30, 50, 100] as const;
export const HOME_LADDER = [15, 30, 50, 100] as const;
export const BURST_LADDER = [25, 50, 100, 150] as const;
export const WEBHOOK_BURST = 200;
export const SMOKE_USERS = 15;
export const SMOKE_WEBHOOK_BURST = 20;

export type LatencySummary = {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

export type StatusCounts = Record<string, number>;

export type LockSnapshot = {
  waiting: number;
  granted: number;
};

export type ResourceSnapshot = {
  rssBytes: number;
  heapUsedBytes: number;
  cpuUserMs: number;
  cpuSystemMs: number;
};

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

export function summarizeLatency(samplesMs: number[]): LatencySummary {
  return {
    count: samplesMs.length,
    p50Ms: percentile(samplesMs, 50),
    p95Ms: percentile(samplesMs, 95),
    p99Ms: percentile(samplesMs, 99),
    maxMs: samplesMs.length === 0 ? 0 : Math.max(...samplesMs),
  };
}

export function addStatus(counts: StatusCounts, status: number): void {
  const key = String(status);
  counts[key] = (counts[key] ?? 0) + 1;
}

export function readResources(
  previousCpu = process.cpuUsage(),
): ResourceSnapshot {
  const cpu = process.cpuUsage(previousCpu);
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    cpuUserMs: Math.round(cpu.user / 1000),
    cpuSystemMs: Math.round(cpu.system / 1000),
  };
}
