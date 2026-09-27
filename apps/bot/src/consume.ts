import type { GiftbotDb } from "@giftbot/domain";
import {
  deactivateTelegramAccountByTelegramUserId,
  readBroadcastJobRef,
  recordBroadcastJobOutcome,
} from "@giftbot/domain";
import { claimNextJob, failJob } from "@giftbot/jobs";
import {
  createLogger,
  createMetrics,
  jobCorrelation,
  METRIC_NAMES,
  runWithCorrelation,
  type Metrics,
  type StructuredLogger,
} from "@giftbot/observability";
import { processBotJob } from "./process-job.js";
import type { TelegramSender } from "./sender.js";
import {
  TelegramPermanentSendError,
  TelegramRetryAfterError,
} from "./telegram-errors.js";

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

export async function runBotConsumer(input: {
  db: GiftbotDb;
  sender: TelegramSender;
  lockedBy: string;
  signal: AbortSignal;
  idleMs?: number;
  metrics?: Metrics;
  logger?: StructuredLogger;
}): Promise<void> {
  const idleMs = input.idleMs ?? 500;
  const metrics = input.metrics ?? createMetrics();
  const logger = input.logger ?? createLogger("bot");
  while (!input.signal.aborted) {
    const job = await claimNextJob(input.db, {
      owner: "bot",
      lockedBy: input.lockedBy,
    });
    if (!job) {
      await delay(idleMs, input.signal);
      continue;
    }
    const ids = jobCorrelation(job);
    try {
      await runWithCorrelation(ids, async () => {
        logger.info("job start", { type: job.type });
        await processBotJob(input.db, job, input.sender);
        metrics.increment(METRIC_NAMES.jobsCompleted);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "bot job failed";
      metrics.increment(METRIC_NAMES.jobsFailed);
      logger.error("job failed", { type: job.type, error: message });
      if (error instanceof TelegramPermanentSendError) {
        const ref = readBroadcastJobRef(job.payload);
        if (ref) {
          await deactivateTelegramAccountByTelegramUserId(input.db, ref.telegramUserId);
          await recordBroadcastJobOutcome(input.db, {
            broadcastId: ref.broadcastId,
            telegramUserId: ref.telegramUserId,
            failed: true,
            error: message,
          });
        }
        await failJob(input.db, job.id, message, job.retryCount, job.maxAttempts, {
          permanent: true,
        });
        continue;
      }
      if (error instanceof TelegramRetryAfterError) {
        await failJob(input.db, job.id, message, job.retryCount, job.maxAttempts, {
          delayMs: error.retryAfterMs,
        });
        continue;
      }
      const outcome = await failJob(
        input.db,
        job.id,
        message,
        job.retryCount,
        job.maxAttempts,
      );
      if (outcome === "dead") {
        const ref = readBroadcastJobRef(job.payload);
        if (ref) {
          await recordBroadcastJobOutcome(input.db, {
            broadcastId: ref.broadcastId,
            telegramUserId: ref.telegramUserId,
            failed: true,
            error: message,
          });
        }
      }
    }
  }
}
