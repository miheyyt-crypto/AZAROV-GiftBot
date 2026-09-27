/**
 * Per-process memory limiter windows.
 * Values are TEMPORARY_UNCONFIRMED operational defaults, not product limits.
 */
export const RATE_LIMIT_DEFAULTS_STATUS = "TEMPORARY_UNCONFIRMED" as const;

/**
 * Read max is per authenticated user (not shared NAT IP).
 * Auth max is per IP for POST /auth/telegram only.
 * Write max is per user for economic POSTs.
 */
export const TEMPORARY_UNCONFIRMED_RATE_LIMIT_DEFAULTS = {
  windowSeconds: 60,
  maxRequests: 400,
  writeMaxRequests: 80,
  authMaxRequests: 200,
  webhookMaxRequests: 300,
} as const;

export type RateLimitPolicy = {
  windowSeconds: number;
  maxRequests: number;
  writeMaxRequests: number;
  authMaxRequests: number;
  webhookMaxRequests: number;
  defaultsStatus: typeof RATE_LIMIT_DEFAULTS_STATUS;
};

export function createRateLimitPolicy(
  overrides: Partial<
    Pick<
      RateLimitPolicy,
      | "windowSeconds"
      | "maxRequests"
      | "writeMaxRequests"
      | "authMaxRequests"
      | "webhookMaxRequests"
    >
  > = {},
): RateLimitPolicy {
  const maxRequests =
    overrides.maxRequests ?? TEMPORARY_UNCONFIRMED_RATE_LIMIT_DEFAULTS.maxRequests;
  return {
    windowSeconds:
      overrides.windowSeconds ??
      TEMPORARY_UNCONFIRMED_RATE_LIMIT_DEFAULTS.windowSeconds,
    maxRequests,
    writeMaxRequests:
      overrides.writeMaxRequests ??
      TEMPORARY_UNCONFIRMED_RATE_LIMIT_DEFAULTS.writeMaxRequests,
    authMaxRequests:
      overrides.authMaxRequests ??
      TEMPORARY_UNCONFIRMED_RATE_LIMIT_DEFAULTS.authMaxRequests,
    webhookMaxRequests:
      overrides.webhookMaxRequests ??
      TEMPORARY_UNCONFIRMED_RATE_LIMIT_DEFAULTS.webhookMaxRequests,
    defaultsStatus: RATE_LIMIT_DEFAULTS_STATUS,
  };
}
