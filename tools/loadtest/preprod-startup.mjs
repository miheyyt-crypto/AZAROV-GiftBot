/**
 * Production-like startup smoke with FAKE credentials + embedded PG.
 * Does not contact Telegram/Kick network (no webhook traffic, OAuth unused).
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { runMigrations, startDevPostgres } from "@giftbot/db";

const root = "E:\\AZAROV-GiftBot-V2.0";
const uploadDir = `${root}\\tools\\loadtest\\.preprod-uploads`;
mkdirSync(uploadDir, { recursive: true });

const postgres = await startDevPostgres({
  port: 55461,
  forceEmbedded: true,
});
await runMigrations(postgres.url);

// Strip host Kick / DEV flags so partial inheritance cannot trip all-or-nothing.
const {
  KICK_CLIENT_ID: _kickId,
  KICK_CLIENT_SECRET: _kickSecret,
  KICK_REDIRECT_URI: _kickRedirect,
  KICK_TOKEN_ENCRYPTION_KEY: _kickKey,
  ALLOW_DEV_AUTH: _devAuth,
  TELEGRAM_LONG_POLLING: _longPoll,
  ...hostEnv
} = process.env;

const env = {
  ...hostEnv,
  NODE_ENV: "production",
  LOG_LEVEL: "info",
  DATABASE_URL: postgres.url,
  TELEGRAM_BOT_TOKEN: "000000000:FAKE-PREPROD-TOKEN",
  TELEGRAM_BOT_USERNAME: "azarov_preprod_bot",
  TELEGRAM_WEBHOOK_SECRET: "preprod-fake-webhook-secret",
  TELEGRAM_LONG_POLLING: "false",
  PUBLIC_BASE_URL: "https://preprod.example.invalid",
  UPLOAD_DIR: uploadDir,
  TRUST_PROXY: "1",
  API_HOST: "127.0.0.1",
  API_PORT: "3010",
  BOT_HEALTH_HOST: "127.0.0.1",
  BOT_HEALTH_PORT: "3011",
  WORKER_HEALTH_HOST: "127.0.0.1",
  WORKER_HEALTH_PORT: "3012",
};

function start(name, script) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (buf) => {
    process.stdout.write(`[${name}] ${buf}`);
  });
  child.stderr.on("data", (buf) => {
    process.stderr.write(`[${name}] ${buf}`);
  });
  return child;
}

const api = start("api", "apps/api/dist/main.js");
const bot = start("bot", "apps/bot/dist/main.js");
const worker = start("worker", "apps/worker/dist/main.js");

await delay(3000);

const live = await fetch("http://127.0.0.1:3010/health/live");
const ready = await fetch("http://127.0.0.1:3010/health/ready");
const liveBody = await live.json();
const readyBody = await ready.json();
const fingerprint = createHash("sha256")
  .update(env.TELEGRAM_BOT_TOKEN)
  .digest("hex")
  .slice(0, 8);

const report = {
  ok: live.ok && ready.ok,
  liveStatus: live.status,
  readyStatus: ready.status,
  live: liveBody,
  ready: readyBody,
  tokenFingerprintPrefix: fingerprint,
};
console.log(JSON.stringify(report));

api.kill("SIGTERM");
bot.kill("SIGTERM");
worker.kill("SIGTERM");
await delay(1500);
await postgres.stop();
process.exit(report.ok ? 0 : 1);
