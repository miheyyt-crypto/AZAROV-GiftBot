import { createAuthPolicy } from "@giftbot/auth";
import {
  assertProductionRuntimeEnv,
  isDevAuthEnabled,
  loadEnv,
  parseCorsOrigins,
  parseTrustProxy,
  resolveAuthTtlOverrides,
  resolveDbConnectTimeoutSeconds,
  resolveDbPoolMax,
} from "@giftbot/config";
import { createDb } from "@giftbot/db";
import {
  createHttpKickOAuthClient,
  ensureShopCatalog,
  parseTokenEncryptionKey,
} from "@giftbot/domain";
import { createRateLimitPolicy } from "@giftbot/rate-limit";
import { createApiApp } from "./app.js";
import type { KickOAuthConfig } from "./kick-oauth-routes.js";

const env = loadEnv();
const processName = "api" as const;

function log(msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      msg,
      process: processName,
      ...extra,
    })}\n`,
  );
}

function buildKickOAuth(): KickOAuthConfig | undefined {
  if (
    !env.KICK_CLIENT_ID ||
    !env.KICK_CLIENT_SECRET ||
    !env.KICK_REDIRECT_URI ||
    !env.KICK_TOKEN_ENCRYPTION_KEY
  ) {
    return undefined;
  }
  return {
    clientId: env.KICK_CLIENT_ID,
    redirectUri: env.KICK_REDIRECT_URI,
    encryptionKey: parseTokenEncryptionKey(env.KICK_TOKEN_ENCRYPTION_KEY),
    client: createHttpKickOAuthClient({
      clientId: env.KICK_CLIENT_ID,
      clientSecret: env.KICK_CLIENT_SECRET,
    }),
    ...(env.KICK_OAUTH_STATE_TTL_SECONDS !== undefined
      ? { stateTtlSeconds: env.KICK_OAUTH_STATE_TTL_SECONDS }
      : {}),
  };
}

function buildAuthPolicy() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is required when DATABASE_URL is set");
  }
  return createAuthPolicy(env.TELEGRAM_BOT_TOKEN, resolveAuthTtlOverrides(env));
}

async function shutdown(
  signal: string,
  app: { close: () => Promise<void> },
  sql?: { end: (options: { timeout: number }) => Promise<void> },
): Promise<void> {
  log("shutting down", { signal });
  await app.close();
  if (sql) {
    await sql.end({ timeout: 5 });
  }
  process.exit(0);
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    log("env skeleton ok");
    return;
  }

  assertProductionRuntimeEnv(env, "api");

  const poolMax = resolveDbPoolMax(env, "api");
  const connectTimeout = resolveDbConnectTimeoutSeconds(env);
  const dbHandle = env.DATABASE_URL
    ? createDb(env.DATABASE_URL, {
        max: poolMax,
        connectTimeout,
      })
    : undefined;
  const kickOAuth = buildKickOAuth();
  const allowDevAuth = isDevAuthEnabled(env);
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  const corsOrigins = parseCorsOrigins(env.CORS_ORIGINS);
  if (env.PUBLIC_BASE_URL && corsOrigins.length === 0) {
    corsOrigins.push(env.PUBLIC_BASE_URL);
  }
  const app = createApiApp(
    dbHandle
      ? {
          db: dbHandle.db,
          sql: dbHandle.sql,
          authPolicy: buildAuthPolicy(),
          allowDevAuth,
          ...(trustProxy !== undefined ? { trustProxy } : {}),
          corsOrigins,
          webhook: {
            ...(env.TELEGRAM_WEBHOOK_SECRET
              ? { telegramSecret: env.TELEGRAM_WEBHOOK_SECRET }
              : {}),
          },
          ...(kickOAuth ? { kickOAuth } : {}),
          ...(env.TELEGRAM_BOT_USERNAME
            ? { telegramBotUsername: env.TELEGRAM_BOT_USERNAME }
            : {}),
          ...(env.UPLOAD_DIR ? { uploadDir: env.UPLOAD_DIR } : {}),
          rateLimitPolicy: createRateLimitPolicy({
            ...(env.RATE_LIMIT_WINDOW_SECONDS !== undefined
              ? { windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS }
              : {}),
            ...(env.RATE_LIMIT_MAX_REQUESTS !== undefined
              ? { maxRequests: env.RATE_LIMIT_MAX_REQUESTS }
              : {}),
            ...(env.RATE_LIMIT_WRITE_MAX_REQUESTS !== undefined
              ? { writeMaxRequests: env.RATE_LIMIT_WRITE_MAX_REQUESTS }
              : {}),
            ...(env.RATE_LIMIT_AUTH_MAX_REQUESTS !== undefined
              ? { authMaxRequests: env.RATE_LIMIT_AUTH_MAX_REQUESTS }
              : {}),
            ...(env.RATE_LIMIT_WEBHOOK_MAX_REQUESTS !== undefined
              ? { webhookMaxRequests: env.RATE_LIMIT_WEBHOOK_MAX_REQUESTS }
              : {}),
          }),
        }
      : { allowDevAuth: false },
  );

  process.once("SIGINT", () => {
    void shutdown("SIGINT", app, dbHandle?.sql);
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM", app, dbHandle?.sql);
  });

  if (dbHandle) {
    await ensureShopCatalog(dbHandle.db);
  }

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  log("live health listening", {
    host: env.API_HOST,
    port: env.API_PORT,
    authRoutes: Boolean(dbHandle),
    allowDevAuth,
    dbPoolMax: poolMax,
  });
}

await main();
