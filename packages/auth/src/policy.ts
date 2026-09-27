/**
 * Production-frozen auth/session windows (product decision #9 closed).
 * InitData freshness is checked only when creating a Mini App / admin session.
 * Existing sessions remain valid until their own TTL expiry or revocation.
 */
export const AUTH_DEFAULTS_STATUS = "PRODUCTION" as const;

/** Telegram WebApp initData maximum age at session creation. */
export const TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = 1_800;

/** Mini App opaque session lifetime after successful auth. */
export const MINI_APP_SESSION_TTL_SECONDS = 2_592_000;

/** Admin session lifetime (intentionally shorter than Mini App). */
export const ADMIN_SESSION_TTL_SECONDS = 7_200;

/**
 * Reject auth_date more than this many seconds in the future (clock skew).
 * Boundary: ageSeconds < -AUTH_DATE_MAX_FUTURE_SKEW_SECONDS → rejected.
 */
export const AUTH_DATE_MAX_FUTURE_SKEW_SECONDS = 60;

/**
 * Canonical production defaults.
 * Env overrides: AUTH_INIT_DATA_MAX_AGE_SECONDS, AUTH_SESSION_TTL_SECONDS,
 * AUTH_ADMIN_SESSION_TTL_SECONDS (positive integers only).
 */
export const PRODUCTION_AUTH_DEFAULTS = {
  initDataMaxAgeSeconds: TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
  sessionTtlSeconds: MINI_APP_SESSION_TTL_SECONDS,
  adminSessionTtlSeconds: ADMIN_SESSION_TTL_SECONDS,
} as const;

/** @deprecated Use PRODUCTION_AUTH_DEFAULTS — kept as alias for older imports. */
export const TEMPORARY_UNCONFIRMED_AUTH_DEFAULTS = PRODUCTION_AUTH_DEFAULTS;

export type AuthPolicy = {
  botToken: string;
  initDataMaxAgeSeconds: number;
  sessionTtlSeconds: number;
  adminSessionTtlSeconds: number;
  defaultsStatus: typeof AUTH_DEFAULTS_STATUS;
};

export function createAuthPolicy(
  botToken: string,
  overrides: Partial<
    Pick<
      AuthPolicy,
      "initDataMaxAgeSeconds" | "sessionTtlSeconds" | "adminSessionTtlSeconds"
    >
  > = {},
): AuthPolicy {
  return {
    botToken,
    initDataMaxAgeSeconds:
      overrides.initDataMaxAgeSeconds ??
      PRODUCTION_AUTH_DEFAULTS.initDataMaxAgeSeconds,
    sessionTtlSeconds:
      overrides.sessionTtlSeconds ??
      PRODUCTION_AUTH_DEFAULTS.sessionTtlSeconds,
    adminSessionTtlSeconds:
      overrides.adminSessionTtlSeconds ??
      PRODUCTION_AUTH_DEFAULTS.adminSessionTtlSeconds,
    defaultsStatus: AUTH_DEFAULTS_STATUS,
  };
}
