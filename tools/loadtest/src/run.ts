import { appendFileSync } from "node:fs";
import os from "node:os";
import {
  assertDiskSpaceOrThrow,
  readDiskFree,
  LOADTEST_MIN_FREE_BYTES,
} from "./disk-guard.js";
import { captureLoadEnvironment } from "./env.js";
import {
  readyIsSelectOnly,
  startLoadHarness,
  waitForOpenBotJobs,
  type LoadHarness,
} from "./harness.js";
import { runPostLoadInvariants } from "./invariants.js";
import { buildReport, type LoadReport } from "./report.js";
import {
  runAuthedGetLadder,
  runDiceBurst,
  runHealthLadder,
  runHomeStartupLadder,
  runHomeStartupSteady,
  runKickWebhookBurst,
  runMixedLoad,
  runPromoFinalSlotRace,
  runRollsJoinBurst,
  runRollsWsClients,
  runUserLadder,
  runWebhookBurst,
  type ScenarioResult,
} from "./scenarios.js";
import { seedLoadDataset, TELEGRAM_ID_BASE } from "./seed.js";
import {
  BURST_LADDER,
  HOME_LADDER,
  SMOKE_USERS,
  SMOKE_WEBHOOK_BURST,
  USER_LADDER,
  WEBHOOK_BURST,
} from "./stats.js";

function recordScenario(
  scenarios: ScenarioResult[],
  result: ScenarioResult,
): void {
  scenarios.push(result);
  const progressPath = process.env.LOADTEST_PROGRESS_PATH?.trim();
  if (progressPath) {
    appendFileSync(progressPath, `${JSON.stringify(result)}\n`, "utf8");
  }
}

function mode(): "legacy" | "default" | "full" | "continue" | "audit" | "burst" {
  const raw = (process.env.LOADTEST_MODE ?? "default").toLowerCase();
  if (
    raw === "legacy" ||
    raw === "full" ||
    raw === "continue" ||
    raw === "audit" ||
    raw === "burst"
  ) {
    return raw;
  }
  return "default";
}

async function guardDisk(label: string, extras: string[]): Promise<void> {
  const snaps = assertDiskSpaceOrThrow(
    label,
    [os.tmpdir(), process.cwd()],
    LOADTEST_MIN_FREE_BYTES,
  );
  extras.push(
    `disk_ok ${label} ${snaps.map((s) => `${s.root}${(s.freeBytes / 1024 ** 3).toFixed(1)}GiB`).join(" ")}`,
  );
}

export async function runLoadtest(
  harness?: LoadHarness,
): Promise<LoadReport> {
  const loadMode = mode();
  const owned =
    harness ??
    (await startLoadHarness(
      loadMode === "burst"
        ? { dbPoolMax: 20, rateLimitMax: 400 }
        : undefined,
    ));
  try {
    const env = captureLoadEnvironment({ dbPoolMax: owned.dbPoolMax });
    const scenarios: ScenarioResult[] = [];
    const extras: string[] = [];
    extras.push(
      `disk_at_start tmp=${(readDiskFree(os.tmpdir()).freeBytes / 1024 ** 3).toFixed(2)}GiB cwd=${(readDiskFree(process.cwd()).freeBytes / 1024 ** 3).toFixed(2)}GiB`,
    );

    if (loadMode === "burst") {
      await guardDisk("burst-before-seed", extras);
      const seed = await seedLoadDataset(owned.sql, { users: 500 });
      extras.push(
        `dataset users=${String(seed.users)} ledger=${String(seed.ledgerRows)} pool=${String(owned.dbPoolMax)}`,
      );
      let telegramCursor = TELEGRAM_ID_BASE;
      for (const concurrency of BURST_LADDER) {
        await guardDisk(`burst-${String(concurrency)}`, extras);
        recordScenario(
          scenarios,
          await runHomeStartupLadder(owned, concurrency, telegramCursor),
        );
        telegramCursor += concurrency;
      }
      recordScenario(
        scenarios,
        await runHomeStartupSteady(owned, 100, telegramCursor),
      );
      telegramCursor += 100;
      const ready = await readyIsSelectOnly(owned.baseUrl);
      extras.push(`health_ready_after_burst=${String(ready)}`);
      if (!ready) {
        extras.push("health not ready after burst");
      }
      recordScenario(
        scenarios,
        await runMixedLoad(owned, 100, 120_000, telegramCursor),
      );
      const invariants = await runPostLoadInvariants(owned.observeSql);
      extras.push(`invariants ${JSON.stringify(invariants)}`);
      extras.push(
        `disk_at_end tmp=${(readDiskFree(os.tmpdir()).freeBytes / 1024 ** 3).toFixed(2)}GiB cwd=${(readDiskFree(process.cwd()).freeBytes / 1024 ** 3).toFixed(2)}GiB`,
      );
    } else if (loadMode === "legacy") {
      let telegramIdBase = 400_000;
      for (const concurrency of USER_LADDER) {
        scenarios.push(await runUserLadder(owned, concurrency, telegramIdBase));
        telegramIdBase += concurrency;
      }
      scenarios.push(await runWebhookBurst(owned, WEBHOOK_BURST, 800_000));
    } else if (loadMode === "continue") {
      // Resume after ENOSPC interrupt: do not re-run the full prior ladder.
      // Fresh harness DB still needs seed; then gaps + light regression only.
      await guardDisk("continue-before-seed", extras);
      const seed = await seedLoadDataset(owned.sql, { users: 10_000 });
      extras.push(
        `dataset users=${String(seed.users)} activated_refs=${String(seed.referralsActivated)} hot_inviter=${String(seed.hotInviterActivated)} ledger=${String(seed.ledgerRows)}`,
      );
      await guardDisk("continue-after-seed", extras);

      // Light regression of previously green hot paths (progressive).
      recordScenario(
        scenarios,
        await runHomeStartupLadder(owned, 50, TELEGRAM_ID_BASE),
      );
      await guardDisk("continue-after-home50", extras);
      recordScenario(
        scenarios,
        await runAuthedGetLadder(
          owned,
          "leaderboard-balance-100",
          "/leaderboard/balance",
          100,
          TELEGRAM_ID_BASE + 200,
        ),
      );
      recordScenario(
        scenarios,
        await runAuthedGetLadder(
          owned,
          "recent-wins-100",
          "/recent-wins?limit=12",
          100,
          TELEGRAM_ID_BASE + 400,
        ),
      );

      await owned.observeSql.unsafe(`
        DELETE FROM rolls_bet_operations;
        DELETE FROM rolls_participants;
        DELETE FROM jobs WHERE type LIKE 'rolls.%';
        DELETE FROM rolls_rounds;
      `);
      const { ensureCurrentRollsRound } = await import("@giftbot/domain");
      await ensureCurrentRollsRound(owned.db);
      recordScenario(
        scenarios,
        await runRollsJoinBurst(owned, 100, TELEGRAM_ID_BASE),
      );
      await guardDisk("continue-after-rolls100", extras);

      // Previously incomplete: WebSocket clients (progressive 50 → 100 → 200).
      for (const n of [50, 100, 200] as const) {
        await guardDisk(`continue-before-ws-${String(n)}`, extras);
        recordScenario(
          scenarios,
          await runRollsWsClients(owned, n, TELEGRAM_ID_BASE + 1000),
        );
      }

      // Promo final-slot race (50 concurrent).
      recordScenario(
        scenarios,
        await runPromoFinalSlotRace(owned, 50, TELEGRAM_ID_BASE + 2000),
      );

      // Mixed load: 50 users × 60s, then 100 × 60s (not full 15m; safer after ENOSPC).
      await guardDisk("continue-before-mixed50", extras);
      recordScenario(
        scenarios,
        await runMixedLoad(owned, 50, 60_000, TELEGRAM_ID_BASE + 3000),
      );
      await guardDisk("continue-before-mixed100", extras);
      recordScenario(
        scenarios,
        await runMixedLoad(owned, 100, 60_000, TELEGRAM_ID_BASE + 4000),
      );

      // Optional longer sustain if still healthy (3 minutes @ 50).
      await guardDisk("continue-before-mixed50-3m", extras);
      recordScenario(
        scenarios,
        await runMixedLoad(owned, 50, 180_000, TELEGRAM_ID_BASE + 5000),
      );

      const invariants = await runPostLoadInvariants(owned.observeSql);
      extras.push(`invariants ${JSON.stringify(invariants)}`);
      if (
        invariants.walletMismatches !== 0 ||
        invariants.negativeWallets !== 0 ||
        invariants.rollsPotMismatches !== 0 ||
        invariants.rollsMultiWinnerRounds !== 0 ||
        invariants.duplicatePromoRedemptions !== 0
      ) {
        extras.push("post-load invariants failed");
      }
      extras.push(
        `disk_at_end tmp=${(readDiskFree(os.tmpdir()).freeBytes / 1024 ** 3).toFixed(2)}GiB cwd=${(readDiskFree(process.cwd()).freeBytes / 1024 ** 3).toFixed(2)}GiB`,
      );
    } else if (loadMode === "default" || loadMode === "full") {
      const seedUsers = 10_000;
      await guardDisk("before-seed", extras);
      const seed = await seedLoadDataset(owned.sql, { users: seedUsers });
      extras.push(
        `dataset users=${String(seed.users)} activated_refs=${String(seed.referralsActivated)} hot_inviter=${String(seed.hotInviterActivated)} ledger=${String(seed.ledgerRows)}`,
      );
      await guardDisk("after-seed", extras);

      for (const concurrency of [1, 10, 50, 100]) {
        scenarios.push(await runHealthLadder(owned, concurrency));
      }

      let telegramCursor = TELEGRAM_ID_BASE;
      const homeLadder =
        loadMode === "full"
          ? ([15, 30, 50, 100, 200] as const)
          : HOME_LADDER;
      for (const concurrency of homeLadder) {
        await guardDisk(`home-${String(concurrency)}`, extras);
        scenarios.push(
          await runHomeStartupLadder(owned, concurrency, telegramCursor),
        );
        telegramCursor += concurrency;
      }

      for (const concurrency of [50, 100, 200] as const) {
        scenarios.push(
          await runAuthedGetLadder(
            owned,
            `leaderboard-balance-${String(concurrency)}`,
            "/leaderboard/balance",
            concurrency,
            telegramCursor,
          ),
        );
        telegramCursor += concurrency;
        scenarios.push(
          await runAuthedGetLadder(
            owned,
            `leaderboard-referrals-${String(concurrency)}`,
            "/leaderboard/referrals",
            concurrency,
            telegramCursor,
          ),
        );
        telegramCursor += concurrency;
        scenarios.push(
          await runAuthedGetLadder(
            owned,
            `contest-summary-${String(concurrency)}`,
            "/contest/referral/summary",
            concurrency,
            telegramCursor,
          ),
        );
        telegramCursor += concurrency;
        scenarios.push(
          await runAuthedGetLadder(
            owned,
            `contest-page-${String(concurrency)}`,
            "/contest/referral",
            concurrency,
            telegramCursor,
          ),
        );
        telegramCursor += concurrency;
        scenarios.push(
          await runAuthedGetLadder(
            owned,
            `recent-wins-${String(concurrency)}`,
            "/recent-wins?limit=12",
            concurrency,
            telegramCursor,
          ),
        );
        telegramCursor += concurrency;
        scenarios.push(
          await runAuthedGetLadder(
            owned,
            `profile-${String(concurrency)}`,
            "/profile",
            concurrency,
            telegramCursor,
          ),
        );
        telegramCursor += concurrency;
      }

      for (const concurrency of [50, 100, 200] as const) {
        scenarios.push(await runDiceBurst(owned, concurrency, telegramCursor));
        telegramCursor += concurrency;
      }

      scenarios.push(await runWebhookBurst(owned, WEBHOOK_BURST, 800_000));
      if (loadMode === "full") {
        scenarios.push(await runWebhookBurst(owned, 500, 801_000));
        scenarios.push(await runWebhookBurst(owned, 1000, 802_000));
      }
      scenarios.push(await runKickWebhookBurst(owned, 100, "01JLOADKICKA"));
      if (loadMode === "full") {
        scenarios.push(await runKickWebhookBurst(owned, 500, "01JLOADKICKB"));
        scenarios.push(await runKickWebhookBurst(owned, 1000, "01JLOADKICKC"));
      }

      for (const players of loadMode === "full" ? [100, 500, 1000] : [100]) {
        await owned.observeSql.unsafe(`
          DELETE FROM rolls_bet_operations;
          DELETE FROM rolls_participants;
          DELETE FROM jobs WHERE type LIKE 'rolls.%';
          DELETE FROM rolls_rounds;
        `);
        const { ensureCurrentRollsRound } = await import("@giftbot/domain");
        await ensureCurrentRollsRound(owned.db);
        await guardDisk(`rolls-${String(players)}`, extras);
        scenarios.push(await runRollsJoinBurst(owned, players, TELEGRAM_ID_BASE));
      }

      const invariants = await runPostLoadInvariants(owned.observeSql);
      extras.push(`invariants ${JSON.stringify(invariants)}`);
      if (
        invariants.walletMismatches !== 0 ||
        invariants.negativeWallets !== 0 ||
        invariants.rollsPotMismatches !== 0 ||
        invariants.rollsMultiWinnerRounds !== 0 ||
        invariants.duplicatePromoRedemptions !== 0
      ) {
        extras.push("post-load invariants failed");
      }
    } else if (loadMode === "audit") {
      const seed = await seedLoadDataset(owned.sql, { users: 2_000 });
      extras.push(
        `dataset users=${String(seed.users)} ledger=${String(seed.ledgerRows)}`,
      );
      const reads: { name: string; path: string }[] = [
        { name: "bootstrap", path: "/bootstrap" },
        { name: "home", path: "/sections/home" },
        { name: "profile", path: "/profile" },
        { name: "shop", path: "/shop/catalog" },
        { name: "leaderboard", path: "/leaderboard/balance" },
        { name: "giveaways", path: "/giveaways" },
        { name: "contest-summary", path: "/contest/referral/summary" },
        { name: "contest-page", path: "/contest/referral" },
      ];
      let telegramCursor = TELEGRAM_ID_BASE;
      for (const concurrency of [10, 25, 50, 100, 200] as const) {
        for (const read of reads) {
          recordScenario(
            scenarios,
            await runAuthedGetLadder(
              owned,
              `${read.name}-${String(concurrency)}`,
              read.path,
              concurrency,
              telegramCursor,
            ),
          );
          telegramCursor += concurrency;
        }
      }
      const { ensureCurrentRollsRound } = await import("@giftbot/domain");
      for (const n of [100, 250, 500, 1000] as const) {
        await owned.observeSql.unsafe(`
          DELETE FROM rolls_bet_operations;
          DELETE FROM rolls_participants;
          DELETE FROM jobs WHERE type LIKE 'rolls.%';
          DELETE FROM rolls_rounds;
        `);
        await ensureCurrentRollsRound(owned.db);
        const ws = await runRollsWsClients(
          owned,
          n,
          TELEGRAM_ID_BASE + 50_000,
        );
        recordScenario(scenarios, ws);
        const failRate =
          ws.requests.total > 0 ? ws.requests.errors / ws.requests.total : 1;
        if (failRate > 0.05) {
          extras.push(
            `ws stop after rolls-ws-${String(n)} failRate=${failRate.toFixed(3)}`,
          );
          break;
        }
      }
      const invariants = await runPostLoadInvariants(owned.observeSql);
      extras.push(`invariants ${JSON.stringify(invariants)}`);
    } else {
      extras.push(`unknown LOADTEST_MODE`);
    }

    const openJobs = await waitForOpenBotJobs(
      owned.db,
      loadMode === "continue" ? 90_000 : 30_000,
    );
    if (openJobs > 0) {
      extras.push(`bot jobs still open after burst: ${String(openJobs)}`);
    }
    if (!(await readyIsSelectOnly(owned.baseUrl))) {
      extras.push("GET /health/ready was not ready after load");
    }
    return buildReport(scenarios, extras, env);
  } finally {
    if (!harness) {
      await owned.stop();
    }
  }
}

export async function runLoadSmoke(
  harness?: LoadHarness,
): Promise<LoadReport> {
  const owned =
    harness ??
    (await startLoadHarness({ port: 55454, forceEmbedded: true }));
  try {
    const env = captureLoadEnvironment({ dbPoolMax: owned.dbPoolMax });
    const scenarios = [
      await runUserLadder(owned, SMOKE_USERS, 500_000),
      await runWebhookBurst(owned, SMOKE_WEBHOOK_BURST, 600_000),
    ];
    const extras: string[] = [];
    const openJobs = await waitForOpenBotJobs(owned.db, 15_000);
    if (openJobs > 0) {
      extras.push(`bot jobs still open after smoke: ${String(openJobs)}`);
    }
    if (!(await readyIsSelectOnly(owned.baseUrl))) {
      extras.push("GET /health/ready was not ready after smoke");
    }
    return buildReport(scenarios, extras, env);
  } finally {
    if (!harness) {
      await owned.stop();
    }
  }
}
