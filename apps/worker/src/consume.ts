import type { GiftbotDb } from "@giftbot/domain";
import { recoverRollsRounds } from "@giftbot/domain";
import {
  claimNextJob,
  enqueueDueKickTokenRefreshes,
  enqueueReconcileSweep,
  failJob,
  KICK_REFRESH_SWEEP_SECONDS,
  TEMPORARY_UNCONFIRMED_RECONCILE_SWEEP_SECONDS,
} from "@giftbot/jobs";
import {
  createLogger,
  createMetrics,
  jobCorrelation,
  METRIC_NAMES,
  runWithCorrelation,
  type Metrics,
  type StructuredLogger,
} from "@giftbot/observability";
import { processWorkerJob, type WorkerJobDeps } from "./process-job.js";

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runWorkerConsumer(input: {
  db: GiftbotDb;
  lockedBy: string;
  signal: AbortSignal;
  idleMs?: number;
  deps?: WorkerJobDeps;
  metrics?: Metrics;
  logger?: StructuredLogger;
}): Promise<void> {
  const idleMs = input.idleMs ?? 500;
  const metrics = input.metrics ?? input.deps?.metrics ?? createMetrics();
  const logger = input.logger ?? input.deps?.logger ?? createLogger("worker");
  const deps: WorkerJobDeps = { ...input.deps, metrics, logger };
  const kickRefreshEnabled = Boolean(deps.kickOAuth && deps.tokenKey);
  let lastSweepAt = 0;
  let lastKickRefreshSweepAt = 0;
  let lastRollsRecoverAt = 0;
  await recoverRollsRounds(input.db).catch(() => undefined);
  while (!input.signal.aborted) {
    const job = await claimNextJob(input.db, {
      owner: "worker",
      lockedBy: input.lockedBy,
    });
    if (!job) {
      const now = Date.now();
      if (
        now - lastSweepAt >=
        TEMPORARY_UNCONFIRMED_RECONCILE_SWEEP_SECONDS * 1000
      ) {
        lastSweepAt = now;
        await enqueueReconcileSweep(input.db);
      }
      if (
        kickRefreshEnabled &&
        now - lastKickRefreshSweepAt >= KICK_REFRESH_SWEEP_SECONDS * 1000
      ) {
        lastKickRefreshSweepAt = now;
        await enqueueDueKickTokenRefreshes(input.db).catch(() => undefined);
      }
      if (now - lastRollsRecoverAt >= 2_000) {
        lastRollsRecoverAt = now;
        await recoverRollsRounds(input.db).catch(() => undefined);
      }
      await delay(idleMs, input.signal);
      continue;
    }
    const ids = jobCorrelation(job);
    try {
      await runWithCorrelation(ids, async () => {
        logger.info("job start", { type: job.type });
        await processWorkerJob(input.db, job, deps);
        metrics.increment(METRIC_NAMES.jobsCompleted);
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "worker job failed";
      metrics.increment(METRIC_NAMES.jobsFailed);
      logger.error("job failed", { type: job.type, error: message });
      await failJob(input.db, job.id, message, job.retryCount, job.maxAttempts);
    }
  }
}
