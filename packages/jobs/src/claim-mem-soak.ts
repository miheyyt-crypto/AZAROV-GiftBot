/**
 * Isolated idle vs empty claimNextJob memory comparison.
 * Uses embedded Postgres only (never production DATABASE_URL).
 * 10–15 minutes is a first look, not proof against a slow leak.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import { processMemoryUsage } from "@giftbot/observability";
import { claimNextJob } from "./claim.js";

const SOAK_MS = Number(process.env.BOT_MEM_SOAK_MS ?? 12 * 60 * 1000);
const WARMUP_MS = Number(process.env.BOT_MEM_SOAK_WARMUP_MS ?? 60 * 1000);
const SAMPLE_MS = Number(process.env.BOT_MEM_SOAK_SAMPLE_MS ?? 60 * 1000);
const IDLE_MS = 500;
const PG_PORT = Number(process.env.BOT_MEM_SOAK_PG_PORT ?? 55461);

type Sample = {
  mode: string;
  tMs: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printSample(mode: string, tMs: number): Sample {
  const memory = processMemoryUsage();
  const row: Sample = { mode, tMs, ...memory };
  console.log(JSON.stringify({ kind: "sample", ...row }));
  return row;
}

async function runChild(mode: "idle" | "claim"): Promise<void> {
  const url = process.env.BOT_MEM_SOAK_CHILD_URL;
  if (!url) {
    throw new Error("BOT_MEM_SOAK_CHILD_URL is required");
  }
  const handle = createDb(url, { max: 5, connectTimeout: 10 });
  const started = Date.now();
  await handle.db.execute(sql`select 1`);
  console.log(
    JSON.stringify({
      kind: "child_start",
      mode,
      pid: process.pid,
      node: process.version,
    }),
  );
  await sleep(WARMUP_MS);
  printSample(mode, Date.now() - started);

  const endAt = started + WARMUP_MS + SOAK_MS;
  let nextSample = Date.now() + SAMPLE_MS;
  while (Date.now() < endAt) {
    if (mode === "claim") {
      const job = await claimNextJob(handle.db, {
        owner: "bot",
        lockedBy: `soak:${process.pid}`,
      });
      if (job) {
        throw new Error("claim-mem-soak expected an empty jobs table");
      }
    }
    const now = Date.now();
    if (now >= nextSample) {
      printSample(mode, now - started);
      nextSample += SAMPLE_MS;
    }
    const untilEnd = endAt - Date.now();
    if (untilEnd <= 0) {
      break;
    }
    const untilSample = nextSample - Date.now();
    const waitMs =
      mode === "claim"
        ? Math.max(1, Math.min(IDLE_MS, untilEnd, Math.max(untilSample, 1)))
        : Math.max(1, Math.min(untilEnd, Math.max(untilSample, 1)));
    await sleep(waitMs);
  }
  printSample(mode, Date.now() - started);
  await handle.sql.end({ timeout: 5 });
}

function spawnChild(
  mode: "idle" | "claim",
  childUrl: string,
): Promise<{ mode: string; samples: Sample[]; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "--child", mode],
      {
        env: {
          ...process.env,
          BOT_MEM_SOAK_CHILD_URL: childUrl,
          DATABASE_URL: childUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${mode} child exited ${code}`));
        return;
      }
      const samples: Sample[] = [];
      for (const line of output.split("\n")) {
        if (!line.includes('"kind":"sample"')) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as Sample & { kind: string };
          samples.push({
            mode: parsed.mode,
            tMs: parsed.tMs,
            rss: parsed.rss,
            heapTotal: parsed.heapTotal,
            heapUsed: parsed.heapUsed,
            external: parsed.external,
            arrayBuffers: parsed.arrayBuffers,
          });
        } catch {
          /* skip non-json */
        }
      }
      resolve({ mode, samples, output });
    });
  });
}

async function runParent(): Promise<void> {
  if (process.env.DATABASE_URL) {
    delete process.env.DATABASE_URL;
  }
  const postgres = await startDevPostgres({
    port: PG_PORT,
    forceEmbedded: true,
  });
  try {
    await runMigrations(postgres.url);
    console.log(
      JSON.stringify({
        kind: "parent_start",
        node: process.version,
        soakMs: SOAK_MS,
        warmupMs: WARMUP_MS,
        pid: process.pid,
      }),
    );
    const [idle, claim] = await Promise.all([
      spawnChild("idle", postgres.url),
      spawnChild("claim", postgres.url),
    ]);
    const idleLast = idle.samples.at(-1);
    const claimLast = claim.samples.at(-1);
    const idleWarm = idle.samples[0];
    const claimWarm = claim.samples[0];
    if (!idleLast || !claimLast || !idleWarm || !claimWarm) {
      throw new Error("missing soak samples");
    }
    console.log(
      JSON.stringify({
        kind: "compare",
        idleAfterWarmup: idleWarm,
        idleFinal: idleLast,
        claimAfterWarmup: claimWarm,
        claimFinal: claimLast,
        deltaRss: claimLast.rss - idleLast.rss,
        deltaHeapUsed: claimLast.heapUsed - idleLast.heapUsed,
        idleRssGrowth: idleLast.rss - idleWarm.rss,
        claimRssGrowth: claimLast.rss - claimWarm.rss,
        idleHeapUsedGrowth: idleLast.heapUsed - idleWarm.heapUsed,
        claimHeapUsedGrowth: claimLast.heapUsed - claimWarm.heapUsed,
      }),
    );
    console.log("CLAIM_MEM_SOAK_OK");
  } finally {
    await postgres.stop();
  }
}

const childIdx = process.argv.indexOf("--child");
if (childIdx >= 0) {
  const mode = process.argv[childIdx + 1];
  if (mode !== "idle" && mode !== "claim") {
    throw new Error("child mode must be idle or claim");
  }
  await runChild(mode);
} else {
  await runParent();
}
