import { z } from "zod";

/**
 * Process-boot env contract.
 *
 * Auth TTL defaults are production-frozen in `@giftbot/auth` (decision #9):
 * initData 1800s, Mini App session 2_592_000s, admin 7200s.
 * Overrides remain optional positive integers via AUTH_* (or alias) vars.
 *
 * DATABASE_URL / secrets stay optional in the Zod schema so `--check` and
 * local hello-health still parse. Production runtime fail-fast is
 * `assertProductionRuntimeEnv` (NODE_ENV=production).
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BOT_HEALTH_HOST: z.string().min(1).default("127.0.0.1"),
  BOT_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WORKER_HEALTH_HOST: z.string().min(1).default("127.0.0.1"),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  DATABASE_URL: z.string().min(1).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  /** Used for referral deep links (`t.me/<username>?start=…`). */
  TELEGRAM_BOT_USERNAME: z.string().min(1).optional(),
  AUTH_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().optional(),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  AUTH_ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  /** Preferred aliases for the AUTH_* TTL overrides (same meaning). */
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  MINI_APP_SESSION_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  TELEGRAM_LONG_POLLING: z.enum(["true", "false"]).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Unused leftover. Kick Events signatures use Kick's RSA public key, not this value. */
  KICK_WEBHOOK_SECRET: z.string().min(1).optional(),
  KICK_CLIENT_ID: z.string().min(1).optional(),
  KICK_CLIENT_SECRET: z.string().min(1).optional(),
  KICK_REDIRECT_URI: z.string().min(1).optional(),
  KICK_TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
  KICK_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_WRITE_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_AUTH_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_WEBHOOK_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
  /**
   * Local Mini App auth without Telegram.
   * Must be exactly "true" and NODE_ENV must not be production.
   */
  ALLOW_DEV_AUTH: z.enum(["true", "false"]).optional(),
  /** Public HTTPS origin for Mini App / OAuth docs (no trailing slash). */
  PUBLIC_BASE_URL: z.string().url().optional(),
  /** Comma-separated CORS origins. Empty = same-origin only (typical nginx). */
  CORS_ORIGINS: z.string().optional(),
  /** Fastify trustProxy: "true" | hop count. Production behind one nginx: "1". */
  TRUST_PROXY: z.string().optional(),
  /** Persistent Welvura screenshot directory (outside release tree). */
  UPLOAD_DIR: z.string().min(1).optional(),
  /** OBS overlay token for /stream/alerts. Never send to Mini App. */
  STREAM_ALERTS_TOKEN: z.string().min(16).optional(),
  /** Piper TTS audio cache (outside release tree). Defaults to UPLOAD_DIR/stream-alerts-tts. */
  STREAM_ALERTS_TTS_DIR: z.string().min(1).optional(),
  /** Local Piper binary. Worker-only; unset skips speech and keeps text alerts. */
  PIPER_BIN: z.string().min(1).optional(),
  /** Path to a ru_RU Piper .onnx model. */
  PIPER_MODEL: z.string().min(1).optional(),
  /** Voice id recorded on the donation row (default dmitri). */
  PIPER_VOICE: z.string().min(1).optional(),
  PIPER_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).optional(),
  /** Silero CIS .pt weights. Worker-only; unset skips Silero. */
  SILERO_TTS_MODEL: z.string().min(1).optional(),
  /** Silero speaker id (default ru_roman). */
  SILERO_TTS_SPEAKER: z.string().min(1).optional(),
  SILERO_TTS_PYTHON: z.string().min(1).optional(),
  SILERO_TTS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(120_000)
    .optional(),
  SILERO_TTS_SAMPLE_RATE: z.coerce
    .number()
    .int()
    .refine((n) => n === 8_000 || n === 24_000 || n === 48_000)
    .optional(),
  SILERO_TTS_THREADS: z.coerce.number().int().positive().max(8).optional(),
  /** postgres.js pool max per process (defaults differ by role). */
  DB_POOL_MAX: z.coerce.number().int().positive().max(200).optional(),
  DB_CONNECT_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(120)
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

export type ProcessRole = "api" | "bot" | "worker";

/** Recommended initial production pool sizes (override with DB_POOL_MAX). */
export const DEFAULT_DB_POOL_MAX: Record<ProcessRole, number> = {
  api: 20,
  worker: 10,
  bot: 5,
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

/** Backend guard: both NODE_ENV≠production and ALLOW_DEV_AUTH=true. */
export function isDevAuthEnabled(
  env: Pick<Env, "NODE_ENV" | "ALLOW_DEV_AUTH">,
): boolean {
  return env.NODE_ENV !== "production" && env.ALLOW_DEV_AUTH === "true";
}

export function loadDatabaseUrl(
  source: NodeJS.ProcessEnv = process.env,
): string {
  return z
    .object({ DATABASE_URL: z.string().min(1) })
    .parse(source).DATABASE_URL;
}

export function resolveAuthTtlOverrides(env: Env): {
  initDataMaxAgeSeconds?: number;
  sessionTtlSeconds?: number;
  adminSessionTtlSeconds?: number;
} {
  const init =
    env.AUTH_INIT_DATA_MAX_AGE_SECONDS ??
    env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS;
  const session =
    env.AUTH_SESSION_TTL_SECONDS ?? env.MINI_APP_SESSION_TTL_SECONDS;
  const admin =
    env.AUTH_ADMIN_SESSION_TTL_SECONDS ?? env.ADMIN_SESSION_TTL_SECONDS;
  return {
    ...(init !== undefined ? { initDataMaxAgeSeconds: init } : {}),
    ...(session !== undefined ? { sessionTtlSeconds: session } : {}),
    ...(admin !== undefined ? { adminSessionTtlSeconds: admin } : {}),
  };
}

export function resolveDbPoolMax(env: Env, role: ProcessRole): number {
  return env.DB_POOL_MAX ?? DEFAULT_DB_POOL_MAX[role];
}

export function resolveDbConnectTimeoutSeconds(env: Env): number {
  return env.DB_CONNECT_TIMEOUT_SECONDS ?? 10;
}

export function parseTrustProxy(
  raw: string | undefined,
): boolean | string | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 0) {
    // Fastify accepts hop count as string; numeric literal breaks typings.
    return String(hops);
  }
  throw new Error("TRUST_PROXY must be true|false|non-negative integer");
}

export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Fail-fast for NODE_ENV=production process start.
 * Never includes secret values in error messages.
 */
export function assertProductionRuntimeEnv(
  env: Env,
  role: ProcessRole,
): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  const missing: string[] = [];
  if (!env.DATABASE_URL) {
    missing.push("DATABASE_URL");
  }
  if (role === "api" || role === "bot") {
    if (!env.TELEGRAM_BOT_TOKEN) {
      missing.push("TELEGRAM_BOT_TOKEN");
    }
  }
  if (role === "api") {
    if (!env.TELEGRAM_WEBHOOK_SECRET) {
      missing.push("TELEGRAM_WEBHOOK_SECRET");
    }
    if (!env.TELEGRAM_BOT_USERNAME) {
      missing.push("TELEGRAM_BOT_USERNAME");
    }
    if (!env.PUBLIC_BASE_URL) {
      missing.push("PUBLIC_BASE_URL");
    }
    if (!env.UPLOAD_DIR) {
      missing.push("UPLOAD_DIR");
    }
  }
  if (env.ALLOW_DEV_AUTH === "true") {
    throw new Error(
      "ALLOW_DEV_AUTH=true is forbidden when NODE_ENV=production",
    );
  }
  if (env.TELEGRAM_LONG_POLLING === "true") {
    throw new Error(
      "TELEGRAM_LONG_POLLING=true is forbidden when NODE_ENV=production (use webhooks)",
    );
  }
  const kickParts = [
    env.KICK_CLIENT_ID,
    env.KICK_CLIENT_SECRET,
    env.KICK_REDIRECT_URI,
    env.KICK_TOKEN_ENCRYPTION_KEY,
  ];
  const kickSet = kickParts.filter(Boolean).length;
  if (kickSet > 0 && kickSet < 4) {
    throw new Error(
      "Kick OAuth requires all of KICK_CLIENT_ID, KICK_CLIENT_SECRET, KICK_REDIRECT_URI, KICK_TOKEN_ENCRYPTION_KEY",
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `production ${role} missing required env: ${missing.join(", ")}`,
    );
  }
}
