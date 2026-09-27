/**
 * Focused Home cold vs warm + Bot drain after webhook burst.
 * Local only; fake credentials; embedded PG via load harness.
 */
import { writeFileSync } from "node:fs";
import {
  countOpenBotJobs,
  startLoadHarness,
  waitForOpenBotJobs,
} from "./dist/harness.js";
import { runHomeStartupLadder, runWebhookBurst } from "./dist/scenarios.js";
import { seedLoadDataset, TELEGRAM_ID_BASE } from "./dist/seed.js";

const harness = await startLoadHarness({ port: 55462, forceEmbedded: true });
try {
  await seedLoadDataset(harness.sql, { users: 200 });
  const cold = await runHomeStartupLadder(harness, 50, TELEGRAM_ID_BASE);
  const warm = await runHomeStartupLadder(harness, 50, TELEGRAM_ID_BASE + 200);
  const beforeJobs = await countOpenBotJobs(harness.db);
  const burst = await runWebhookBurst(harness, 100, 900_000);
  const openAfter30 = await waitForOpenBotJobs(harness.db, 30_000);
  const openAfter90 = await waitForOpenBotJobs(harness.db, 60_000);
  const report = {
    coldHome50: {
      p50: cold.latency.p50Ms,
      p95: cold.latency.p95Ms,
      errors: cold.latency.count && cold.requests.errors,
      durationMs: cold.durationMs,
    },
    warmHome50: {
      p50: warm.latency.p50Ms,
      p95: warm.latency.p95Ms,
      errors: warm.requests.errors,
      durationMs: warm.durationMs,
    },
    botDrain: {
      beforeJobs,
      burstErrors: burst.requests.errors,
      openAfter30s: openAfter30,
      openAfter90sTotalWait: openAfter90,
    },
    diagnosis:
      warm.latency.p95Ms < cold.latency.p95Ms * 0.6
        ? "cold_home_elevated_vs_warm_suggests_cache_or_pg_warmup"
        : "cold_and_warm_similar_look_elsewhere",
  };
  writeFileSync(
    "E:/AZAROV-GiftBot-V2.0/tools/loadtest/PREPROD_FOCUSED.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await harness.stop();
}
