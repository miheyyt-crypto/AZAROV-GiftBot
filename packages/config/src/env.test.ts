import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertProductionRuntimeEnv,
  isDevAuthEnabled,
  loadEnv,
  parseCorsOrigins,
  parseTrustProxy,
  resolveAuthTtlOverrides,
  resolveDbPoolMax,
} from "./env.js";

test("loadEnv applies production-safe defaults", () => {
  const env = loadEnv({ NODE_ENV: "production" });
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.LOG_LEVEL, "info");
  assert.equal(env.API_PORT, 3000);
});

test("isDevAuthEnabled requires non-production and ALLOW_DEV_AUTH=true", () => {
  assert.equal(
    isDevAuthEnabled({ NODE_ENV: "development", ALLOW_DEV_AUTH: "true" }),
    true,
  );
  assert.equal(
    isDevAuthEnabled({ NODE_ENV: "production", ALLOW_DEV_AUTH: "true" }),
    false,
  );
  assert.equal(
    isDevAuthEnabled({ NODE_ENV: "development", ALLOW_DEV_AUTH: "false" }),
    false,
  );
});

test("assertProductionRuntimeEnv rejects incomplete production API env", () => {
  const env = loadEnv({ NODE_ENV: "production" });
  assert.throws(
    () => assertProductionRuntimeEnv(env, "api"),
    /missing required env/,
  );
});

test("assertProductionRuntimeEnv rejects ALLOW_DEV_AUTH in production", () => {
  const env = loadEnv({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://giftbot:giftbot@127.0.0.1:5432/giftbot",
    TELEGRAM_BOT_TOKEN: "1:fake",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    TELEGRAM_BOT_USERNAME: "azarov_bot",
    PUBLIC_BASE_URL: "https://example.invalid",
    UPLOAD_DIR: "/var/lib/azarov-giftbot/uploads",
    ALLOW_DEV_AUTH: "true",
  });
  assert.throws(
    () => assertProductionRuntimeEnv(env, "api"),
    /ALLOW_DEV_AUTH/,
  );
});

test("assertProductionRuntimeEnv rejects long polling in production", () => {
  const env = loadEnv({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://giftbot:giftbot@127.0.0.1:5432/giftbot",
    TELEGRAM_BOT_TOKEN: "1:fake",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    TELEGRAM_BOT_USERNAME: "azarov_bot",
    PUBLIC_BASE_URL: "https://example.invalid",
    UPLOAD_DIR: "/var/lib/azarov-giftbot/uploads",
    TELEGRAM_LONG_POLLING: "true",
  });
  assert.throws(
    () => assertProductionRuntimeEnv(env, "api"),
    /TELEGRAM_LONG_POLLING/,
  );
});

test("assertProductionRuntimeEnv accepts complete production API env", () => {
  const env = loadEnv({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://giftbot:giftbot@127.0.0.1:5432/giftbot",
    TELEGRAM_BOT_TOKEN: "1:fake",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    TELEGRAM_BOT_USERNAME: "azarov_bot",
    PUBLIC_BASE_URL: "https://example.invalid",
    UPLOAD_DIR: "/var/lib/azarov-giftbot/uploads",
    TRUST_PROXY: "1",
    TELEGRAM_LONG_POLLING: "false",
  });
  assert.doesNotThrow(() => assertProductionRuntimeEnv(env, "api"));
});

test("resolveAuthTtlOverrides prefers AUTH_* then aliases", () => {
  const env = loadEnv({
    AUTH_INIT_DATA_MAX_AGE_SECONDS: "1800",
    MINI_APP_SESSION_TTL_SECONDS: "2592000",
  });
  assert.deepEqual(resolveAuthTtlOverrides(env), {
    initDataMaxAgeSeconds: 1800,
    sessionTtlSeconds: 2_592_000,
  });
});

test("resolveDbPoolMax uses role defaults", () => {
  const env = loadEnv({});
  assert.equal(resolveDbPoolMax(env, "api"), 20);
  assert.equal(resolveDbPoolMax(env, "worker"), 10);
  assert.equal(resolveDbPoolMax(env, "bot"), 5);
  assert.equal(resolveDbPoolMax(loadEnv({ DB_POOL_MAX: "40" }), "api"), 40);
});

test("parseTrustProxy and CORS helpers", () => {
  assert.equal(parseTrustProxy("1"), "1");
  assert.equal(parseTrustProxy("true"), true);
  assert.deepEqual(parseCorsOrigins("https://a.example, https://b.example"), [
    "https://a.example",
    "https://b.example",
  ]);
});
