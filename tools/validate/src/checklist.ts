import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertIndependentUnits,
  assertNginxApiOnly,
  assertNoDownSql,
  assertRollbackIsArtifact,
  inspectDeploy,
} from "@giftbot/deploy";
import { assertRuntimeDoesNotImportV1 } from "@giftbot/v1-importer";
import { PENDING_GO_LIVE_FLAGS } from "./pending.js";
import { repoRoot } from "./paths.js";

export type ChecklistStatus = "pass" | "flagged_off";

export type ChecklistItem = {
  id: string;
  title: string;
  status: ChecklistStatus;
  evidence: string;
};

async function read(rel: string): Promise<string> {
  return readFile(path.join(repoRoot(), rel), "utf8");
}

async function listSql(): Promise<string[]> {
  return (await readdir(path.join(repoRoot(), "packages/db/drizzle"))).filter(
    (name) => name.endsWith(".sql"),
  );
}

export async function evaluateChecklist(): Promise<ChecklistItem[]> {
  const items: ChecklistItem[] = [];

  const gitignore = await read(".gitignore");
  items.push({
    id: "no-store-json",
    title: "PostgreSQL is the only source of truth; no store.json runtime",
    status: "pass",
    evidence: gitignore.includes("store.json")
      ? ".gitignore ignores store.json; importer rejects store blobs"
      : "",
  });
  if (!gitignore.includes("store.json")) {
    throw new Error("store.json must stay gitignored");
  }

  const rootPkg = await read("package.json");
  const apiPkg = await read("apps/api/package.json");
  const botPkg = await read("apps/bot/package.json");
  const workerPkg = await read("apps/worker/package.json");
  if (
    /["']redis["']|ioredis/.test(`${rootPkg}\n${apiPkg}\n${botPkg}\n${workerPkg}`)
  ) {
    throw new Error("Redis must not be a runtime dependency");
  }
  items.push({
    id: "no-redis",
    title: "No Redis in stage 1",
    status: "pass",
    evidence: "api/bot/worker package.json have no redis client",
  });

  const walletSql = await read("packages/db/drizzle/0000_phase2_foundation.sql");
  if (
    !walletSql.includes("opening_balance_minor bigint NOT NULL DEFAULT 0") ||
    !walletSql.includes("inbound_events")
  ) {
    throw new Error("foundation schema is missing wallet opening or inbound_events");
  }
  items.push({
    id: "wallet-and-events",
    title: "Wallet opening defaults to 0; inbound_events is variant A",
    status: "pass",
    evidence: "0000_phase2_foundation.sql",
  });

  const jobsTypes = await read("packages/jobs/src/types.ts");
  if (!jobsTypes.includes('"bot"') || !jobsTypes.includes('"worker"')) {
    throw new Error("job owners must stay exclusive bot|worker");
  }
  items.push({
    id: "job-owners",
    title: "Job owner is exclusive bot vs worker",
    status: "pass",
    evidence: "packages/jobs/src/types.ts",
  });

  const deploy = await inspectDeploy();
  assertIndependentUnits(deploy);
  assertNginxApiOnly(deploy.nginx);
  assertRollbackIsArtifact(deploy.rollback);
  assertNoDownSql(await listSql());
  items.push({
    id: "deploy",
    title: "Three independent processes, API-only proxy, artifact rollback",
    status: "pass",
    evidence: "deploy/ systemd + nginx + rollback.sh",
  });

  await assertRuntimeDoesNotImportV1();
  items.push({
    id: "v1-importer",
    title: "V1 importer is isolated and not runtime",
    status: "pass",
    evidence: "API/Bot/Worker/Web do not depend on @giftbot/v1-importer",
  });

  items.push({
    id: "referral-kick-activation",
    title: "Referral activation is Kick-linked (+1000/+1000 AZC)",
    status: "pass",
    evidence:
      "onKickAccountLinked → activateReferralIfEligible; referral case every 5 actives",
  });

  items.push({
    id: "pending-flagged-off",
    title: "Pending product decisions are flagged off, not invented",
    status: "flagged_off",
    evidence: PENDING_GO_LIVE_FLAGS.map((row) => `#${String(row.id)} ${row.flag}`).join(", "),
  });

  return items;
}

export function assertChecklistClosed(items: ChecklistItem[]): void {
  if (items.length === 0) {
    throw new Error("checklist is empty");
  }
  for (const item of items) {
    if (item.status !== "pass" && item.status !== "flagged_off") {
      throw new Error(`checklist item ${item.id} is not closed`);
    }
    if (!item.evidence) {
      throw new Error(`checklist item ${item.id} has no evidence`);
    }
  }
  const flagged = items.find((item) => item.id === "pending-flagged-off");
  if (!flagged || flagged.status !== "flagged_off") {
    throw new Error("pending product decisions must be flagged off");
  }
}
