/**
 * Local browser QA stack for Windows/macOS/Linux.
 * Postgres strategy (automatic):
 *   1) Reuse reachable DATABASE_URL / docker-compose URL if already up
 *   2) Optional Docker compose postgres when `docker` is available
 *   3) Else persistent embedded Postgres via @giftbot/db (same helper family as tests)
 *
 * NODE_ENV=development, ALLOW_DEV_AUTH=true — never for production.
 *
 * Usage: npm.cmd exec --yes -- pnpm@10.15.1 dev:local
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploadDir = path.join(root, ".local-uploads");
const persistentPgDir = path.join(root, ".local-dev-pg");
const dbUrlFile = path.join(root, ".local-dev-db-url");
mkdirSync(uploadDir, { recursive: true });

const DEFAULT_WEB_PORT = Number(process.env.VITE_PORT ?? 5173);
const DEFAULT_API_PORT = Number(process.env.API_PORT ?? 3000);
const DOCKER_PG_URL = "postgresql://giftbot:giftbot@127.0.0.1:5433/giftbot";

function loadDotEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(start, options = {}) {
  const exclude = new Set(options.exclude ?? []);
  let port = start;
  for (let i = 0; i < 40; i += 1) {
    if (!exclude.has(port) && (await portFree(port))) {
      return port;
    }
    port += 1;
  }
  throw new Error(`No free TCP port near ${String(start)}`);
}

async function waitHttpOk(url, attempts = 90) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return true;
      }
    } catch {
      /* retry */
    }
    await delay(500);
  }
  return false;
}

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/** Windows needs a shell for `.cmd` shims; node.exe must not use shell. */
function spawnOpts(command, env) {
  const needsShell =
    process.platform === "win32" &&
    (command.endsWith(".cmd") ||
      command.endsWith(".bat") ||
      command === "npm" ||
      command === "pnpm" ||
      command === "docker");
  return {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: needsShell,
  };
}

function spawnLogged(command, args, env, label) {
  const child = spawn(command, args, spawnOpts(command, env));
  const prefix = `[${label}] `;
  child.stdout?.on("data", (buf) => {
    process.stdout.write(prefix + String(buf));
  });
  child.stderr?.on("data", (buf) => {
    process.stderr.write(prefix + String(buf));
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(
        `${prefix}exited code=${String(code)} signal=${String(signal)}`,
      );
    }
  });
  return child;
}

function runCapture(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, spawnOpts(command, env));
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b) => {
      stdout += String(b);
    });
    child.stderr?.on("data", (b) => {
      stderr += String(b);
    });
    child.on("error", (error) => {
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}${error instanceof Error ? error.message : String(error)}`,
      });
    });
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function dockerAvailable() {
  const result = await runCapture(
    process.platform === "win32" ? "where.exe" : "which",
    ["docker"],
    process.env,
  );
  if (result.code !== 0) {
    return false;
  }
  const version = await runCapture("docker", ["--version"], process.env);
  return version.code === 0;
}

async function tryDockerComposePostgres() {
  if (!(await dockerAvailable())) {
    return false;
  }
  if (!existsSync(path.join(root, "docker-compose.yml"))) {
    return false;
  }
  console.log("Docker available — starting compose postgres on :5433 …");
  const up = await runCapture(
    "docker",
    ["compose", "up", "-d", "postgres"],
    process.env,
  );
  if (up.code !== 0) {
    console.warn("Docker compose failed; falling back to embedded Postgres.");
    console.warn(up.stderr.trim() || up.stdout.trim());
    return false;
  }
  for (let i = 0; i < 40; i += 1) {
    const { probeDatabaseUrl } = await importDb();
    if (await probeDatabaseUrl(DOCKER_PG_URL)) {
      return true;
    }
    await delay(500);
  }
  console.warn("Docker Postgres did not become ready; falling back to embedded.");
  return false;
}

async function importDb() {
  // Use built package entry so the launcher works without tsx.
  const mod = await import(
    pathToFileURL(path.join(root, "packages/db/dist/index.js")).href
  );
  return mod;
}

const fileEnv = {
  ...loadDotEnvFile(path.join(root, ".env")),
  ...loadDotEnvFile(path.join(root, ".env.local")),
};

const apiPort = await findFreePort(
  Number(fileEnv.API_PORT ?? process.env.API_PORT ?? DEFAULT_API_PORT),
);
const workerHealthPort = await findFreePort(
  Number(fileEnv.WORKER_HEALTH_PORT ?? process.env.WORKER_HEALTH_PORT ?? 3002),
  { exclude: [apiPort] },
);
const webPort = await findFreePort(
  Number(fileEnv.VITE_PORT ?? process.env.VITE_PORT ?? DEFAULT_WEB_PORT),
  { exclude: [apiPort, workerHealthPort] },
);

/** @type {string | undefined} */
let databaseStrategy;
/** @type {{ url: string; stop: () => Promise<void> } | undefined} */
let pgHandle;
/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let shuttingDown = false;

async function shutdown(signal = "SIGINT") {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`\nShutting down (${signal}) …`);
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  await delay(800);
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
  if (pgHandle) {
    try {
      await pgHandle.stop();
    } catch (error) {
      console.warn(
        "embedded Postgres stop:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

console.log("=== AZAROV GiftBot V2 local browser QA ===");
console.log("Building @giftbot/db + API + Worker …");
{
  const build = await runCapture(
    npmBin(),
    [
      "exec",
      "--yes",
      "--",
      "pnpm@10.15.1",
      "--filter",
      "@giftbot/db",
      "--filter",
      "@giftbot/api",
      "--filter",
      "@giftbot/worker",
      "build",
    ],
    { ...process.env, ...fileEnv },
  );
  if (build.code !== 0) {
    process.stderr.write(build.stderr || build.stdout);
    throw new Error(`build exit ${String(build.code)}`);
  }
}

const { probeDatabaseUrl, startPersistentLocalPostgres, runMigrations } =
  await importDb();

const configuredUrl =
  fileEnv.DATABASE_URL ?? process.env.DATABASE_URL ?? undefined;
const candidateUrls = [
  ...(configuredUrl ? [configuredUrl] : []),
  DOCKER_PG_URL,
  ...(existsSync(dbUrlFile)
    ? [readFileSync(dbUrlFile, "utf8").trim()].filter(Boolean)
    : []),
];

let databaseUrl = "";
for (const url of candidateUrls) {
  if (await probeDatabaseUrl(url)) {
    databaseUrl = url;
    databaseStrategy =
      url.includes(":5433/")
        ? "existing/docker-compose Postgres :5433"
        : "existing DATABASE_URL";
    console.log(`Reusing reachable Postgres (${databaseStrategy}).`);
    break;
  }
}

if (!databaseUrl) {
  const dockerOk = await tryDockerComposePostgres();
  if (dockerOk && (await probeDatabaseUrl(DOCKER_PG_URL))) {
    databaseUrl = DOCKER_PG_URL;
    databaseStrategy = "docker compose postgres :5433";
  }
}

if (!databaseUrl) {
  console.log(
    `Docker unavailable or unused — starting persistent embedded Postgres in ${persistentPgDir}`,
  );
  pgHandle = await startPersistentLocalPostgres({
    databaseDir: persistentPgDir,
  });
  databaseUrl = pgHandle.url;
  databaseStrategy = `embedded-postgres persistent (${persistentPgDir})`;
  writeFileSync(dbUrlFile, `${databaseUrl}\n`, "utf8");
}

const env = {
  ...process.env,
  ...fileEnv,
  NODE_ENV: "development",
  LOG_LEVEL: fileEnv.LOG_LEVEL ?? "info",
  ALLOW_DEV_AUTH: "true",
  TELEGRAM_LONG_POLLING: "false",
  DATABASE_URL: databaseUrl,
  PGCLIENTENCODING: "UTF8",
  TELEGRAM_BOT_TOKEN:
    fileEnv.TELEGRAM_BOT_TOKEN ??
    process.env.TELEGRAM_BOT_TOKEN ??
    "000000000:LOCAL-DEV-BOT-TOKEN",
  TELEGRAM_BOT_USERNAME:
    fileEnv.TELEGRAM_BOT_USERNAME ??
    process.env.TELEGRAM_BOT_USERNAME ??
    "local_dev_bot",
  API_HOST: "127.0.0.1",
  API_PORT: String(apiPort),
  WORKER_HEALTH_HOST: "127.0.0.1",
  WORKER_HEALTH_PORT: String(workerHealthPort),
  UPLOAD_DIR: fileEnv.UPLOAD_DIR ?? uploadDir,
};

console.log(`NODE_ENV=${env.NODE_ENV} ALLOW_DEV_AUTH=${env.ALLOW_DEV_AUTH}`);
console.log(
  `DATABASE_URL=${String(env.DATABASE_URL).replace(/:[^:@/]+@/, ":***@")}`,
);
console.log(`Database strategy: ${databaseStrategy}`);

console.log("Running migrations 0000→latest …");
await runMigrations(databaseUrl);

children.push(
  spawnLogged(
    process.execPath,
    [path.join(root, "apps/api/dist/main.js")],
    env,
    "api",
  ),
);
children.push(
  spawnLogged(
    process.execPath,
    [path.join(root, "apps/worker/dist/main.js")],
    env,
    "worker",
  ),
);

const apiReady = await waitHttpOk(`http://127.0.0.1:${apiPort}/health/live`);
if (!apiReady) {
  console.error("API failed to become ready on", apiPort);
  await shutdown("api-failed");
}

children.push(
  spawnLogged(
    npmBin(),
    [
      "exec",
      "--yes",
      "--",
      "pnpm@10.15.1",
      "--filter",
      "@giftbot/web",
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    env,
    "web",
  ),
);

const webReady = await waitHttpOk(`http://127.0.0.1:${webPort}/`);
if (!webReady) {
  console.error("Vite failed to become ready on", webPort);
  await shutdown("web-failed");
}

// Smoke: /dev/auth + bootstrap (no Telegram).
const authRes = await fetch(`http://127.0.0.1:${apiPort}/dev/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ role: "user" }),
});
if (!authRes.ok) {
  console.error("POST /dev/auth failed:", authRes.status, await authRes.text());
  await shutdown("dev-auth-failed");
}
const authBody = (await authRes.json());
const bootRes = await fetch(`http://127.0.0.1:${apiPort}/bootstrap`, {
  headers: { authorization: `Bearer ${authBody.token}` },
});
if (!bootRes.ok) {
  console.error("GET /bootstrap failed:", bootRes.status);
  await shutdown("bootstrap-failed");
}

const adminAuth = await fetch(`http://127.0.0.1:${apiPort}/dev/auth`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ role: "admin" }),
});
if (!adminAuth.ok) {
  console.error("POST /dev/auth admin failed:", adminAuth.status);
  await shutdown("dev-admin-failed");
}

console.log("");
console.log("==============================================");
console.log("AZAROV GiftBot V2 LOCAL QA READY");
console.log("");
console.log(`User:`);
console.log(`  http://127.0.0.1:${webPort}/?dev=user`);
console.log(`Admin:`);
console.log(`  http://127.0.0.1:${webPort}/?dev=admin`);
console.log(`API:`);
console.log(`  http://127.0.0.1:${apiPort}`);
console.log(`Database:`);
console.log(`  ${databaseStrategy}`);
console.log("Press Ctrl+C to stop (embedded data directory is kept).");
console.log("==============================================");

writeFileSync(
  path.join(root, "tools/loadtest/DEV_LOCAL_READY.json"),
  `${JSON.stringify(
    {
      webPort,
      apiPort,
      userUrl: `http://127.0.0.1:${webPort}/?dev=user`,
      adminUrl: `http://127.0.0.1:${webPort}/?dev=admin`,
      databaseStrategy,
      databaseUrlRedacted: String(databaseUrl).replace(/:[^:@/]+@/, ":***@"),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await new Promise(() => undefined);
