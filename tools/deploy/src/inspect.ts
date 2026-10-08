import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { deployDir, repoRoot } from "./paths.js";

export const UNIT_FILES = [
  "giftbot-migrate.service",
  "giftbot-api.service",
  "giftbot-bot.service",
  "giftbot-worker.service",
] as const;

export const RUNTIME_UNITS = [
  "giftbot-api.service",
  "giftbot-bot.service",
  "giftbot-worker.service",
] as const;

const SECRET_ASSIGNMENT =
  /^(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|KICK_CLIENT_SECRET|KICK_TOKEN_ENCRYPTION_KEY|DATABASE_URL)=(\S+)/m;
const TELEGRAM_TOKEN_SHAPE = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/;

export type DeployInspection = {
  units: Record<string, string>;
  nginx: string;
  rollback: string;
  backup: string;
  restore: string;
  envExample: string;
  drizzleSql: string[];
  gitignore: string;
};

export async function inspectDeploy(): Promise<DeployInspection> {
  const root = repoRoot();
  const deploy = deployDir();
  const units: Record<string, string> = {};
  for (const name of UNIT_FILES) {
    units[name] = await readFile(path.join(deploy, "systemd", name), "utf8");
  }

  return {
    units,
    nginx: await readFile(path.join(deploy, "nginx", "giftbot.conf"), "utf8"),
    rollback: await readFile(path.join(deploy, "rollback.sh"), "utf8"),
    backup: await readFile(path.join(deploy, "backup", "backup.sh"), "utf8"),
    restore: await readFile(path.join(deploy, "backup", "restore.sh"), "utf8"),
    envExample: await readFile(
      path.join(deploy, "env", "giftbot.env.example"),
      "utf8",
    ),
    drizzleSql: (await readdir(path.join(root, "packages/db/drizzle"))).filter(
      (name) => name.endsWith(".sql"),
    ),
    gitignore: await readFile(path.join(root, ".gitignore"), "utf8"),
  };
}

export function execStartLine(unit: string): string {
  const line = unit
    .split(/\r?\n/)
    .find((row) => row.startsWith("ExecStart="));
  if (!line) {
    throw new Error("unit is missing ExecStart");
  }
  return line.slice("ExecStart=".length);
}

export function assertIndependentUnits(inspection: DeployInspection): void {
  const starts = RUNTIME_UNITS.map((name) => {
    const unit = inspection.units[name];
    if (!unit) {
      throw new Error(`missing unit ${name}`);
    }
    return { name, start: execStartLine(unit), body: unit };
  });

  const expected: Record<(typeof RUNTIME_UNITS)[number], string> = {
    "giftbot-api.service": "apps/api/dist/main.js",
    "giftbot-bot.service": "apps/bot/dist/main.js",
    "giftbot-worker.service": "apps/worker/dist/main.js",
  };

  for (const row of starts) {
    const needle = expected[row.name];
    if (!row.start.includes(needle)) {
      throw new Error(`${row.name} ExecStart must run ${needle}`);
    }
    for (const other of Object.values(expected)) {
      if (other !== needle && row.start.includes(other)) {
        throw new Error(`${row.name} must not start ${other}`);
      }
    }
    if (row.body.includes("Type=oneshot")) {
      throw new Error(`${row.name} is a long-running process, not oneshot`);
    }
  }

  const migrate = inspection.units["giftbot-migrate.service"];
  if (!migrate) {
    throw new Error("missing giftbot-migrate.service");
  }
  if (!migrate.includes("Type=oneshot")) {
    throw new Error("migrate unit must be Type=oneshot");
  }
  const migrateStart = execStartLine(migrate);
  if (!migrateStart.includes("packages/db/dist/migrate.js")) {
    throw new Error("migrate unit must run packages/db/dist/migrate.js");
  }
  const migrateExec = migrate
    .split(/\r?\n/)
    .filter((row) => /^Exec(Start|Stop|Reload)=/.test(row))
    .join("\n");
  if (/down/i.test(migrateExec)) {
    throw new Error("migrate unit must not invoke a down migration");
  }

  for (const name of RUNTIME_UNITS) {
    const unit = inspection.units[name];
    if (!unit) {
      throw new Error(`missing unit ${name}`);
    }
    for (const peer of RUNTIME_UNITS) {
      if (peer !== name && unit.includes(`After=${peer}`)) {
        throw new Error(`${name} must not After= ${peer}`);
      }
    }
  }
}

export function assertNginxApiOnly(nginx: string): void {
  if (!nginx.includes("127.0.0.1:3000") && !nginx.includes("giftbot_api")) {
    throw new Error("nginx must proxy Mini App/API traffic to the API process");
  }
  if (nginx.includes("127.0.0.1:3001") || nginx.includes("127.0.0.1:3002")) {
    throw new Error("nginx must not expose Bot or Worker as public HTTP");
  }
  if (!nginx.includes("apps/web/dist")) {
    throw new Error("nginx must serve the static Mini App from apps/web/dist");
  }
  if (!/client_max_body_size\s+256k/.test(nginx)) {
    throw new Error("nginx client_max_body_size must be 256k");
  }
  if (
    !/location\s+=\s+\/shop\/gif-uploads[\s\S]{0,500}client_max_body_size\s+8m/.test(
      nginx,
    )
  ) {
    throw new Error("nginx must raise body size only on /shop/gif-uploads to 8m");
  }
}

export function assertRollbackIsArtifact(rollback: string): void {
  if (!rollback.includes("ln -sfn")) {
    throw new Error("rollback must switch the current artifact symlink");
  }
  if (
    !rollback.includes("giftbot-api.service") ||
    !rollback.includes("giftbot-bot.service") ||
    !rollback.includes("giftbot-worker.service")
  ) {
    throw new Error("rollback must restart the three independent units");
  }
  if (rollback.includes("giftbot-migrate.service")) {
    throw new Error("rollback must not start migrate");
  }
  if (!/refuse:.*down/i.test(rollback)) {
    throw new Error("rollback must refuse down-migration arguments");
  }
}

export function assertBackupUsesPgDump(backup: string, restore: string): void {
  if (!backup.includes("pg_dump")) {
    throw new Error("VPS backup must use pg_dump");
  }
  if (!restore.includes("pg_restore")) {
    throw new Error("VPS restore must use pg_restore");
  }
  if (/drizzle-kit\s+drop|migrate\s+down/i.test(`${backup}\n${restore}`)) {
    throw new Error("backup/restore must not run down migrations");
  }
}

export function assertNoDownSql(files: string[]): void {
  const down = files.filter((name) => /down/i.test(name));
  if (down.length > 0) {
    throw new Error(`drizzle contains down files: ${down.join(", ")}`);
  }
}

export function assertEnvExampleHasNoSecrets(envExample: string): void {
  const assigned = envExample.match(SECRET_ASSIGNMENT);
  if (assigned) {
    throw new Error(`env example assigns a secret value: ${assigned[1]}`);
  }
  if (TELEGRAM_TOKEN_SHAPE.test(envExample)) {
    throw new Error("env example contains a Telegram token shape");
  }
}

export function assertGitignoresSecrets(gitignore: string): void {
  if (!gitignore.includes(".env")) {
    throw new Error(".gitignore must ignore .env");
  }
  if (!gitignore.includes("*.dump")) {
    throw new Error(".gitignore must ignore *.dump");
  }
}
