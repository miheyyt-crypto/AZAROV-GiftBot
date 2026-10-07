import type { AuthDatabase, AuthPolicy } from "@giftbot/auth";
import type { Metrics, StructuredLogger } from "@giftbot/observability";
import {
  createGiveawayImageStorage,
  createBroadcastImageStorage,
  type SubmissionFileStorage,
} from "@giftbot/domain";
import {
  createMemoryRateLimiter,
  createRateLimitPolicy,
  createTieredMemoryRateLimiter,
  type RateLimitPolicy,
  type RateLimiter,
} from "@giftbot/rate-limit";
import Fastify from "fastify";
import { registerAchievementRoutes } from "./achievement-routes.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerBootstrapRoute } from "./bootstrap.js";
import { registerBroadcastRoutes } from "./broadcast-routes.js";
import { registerCashRoutes } from "./cash-routes.js";
import { registerEconomyRoutes } from "./economy-routes.js";
import { registerContestRoutes } from "./contest-routes.js";
import { registerDevAuthDisabled, registerDevAuthRoutes } from "./dev-routes.js";
import { registerFreeCaseRoutes } from "./free-case-routes.js";
import { registerGiveawayRoutes } from "./giveaway-routes.js";
import { registerGramRoutes } from "./gram-routes.js";
import { registerPaidCaseRoutes } from "./paid-case-routes.js";
import { registerLeaderboardRoutes } from "./leaderboard-routes.js";
import { registerReferralRoutes } from "./referral-routes.js";
import { registerHealthRoutes } from "./health.js";
import "./http-limit.js";
import type { KickOAuthConfig } from "./kick-oauth-routes.js";
import { registerKickOAuthRoutes } from "./kick-oauth-routes.js";
import { registerObservability } from "./observability.js";
import { registerProfileRoutes } from "./profile-routes.js";
import { registerPromoRoutes } from "./promo-routes.js";
import { registerSectionRoutes } from "./sections.js";
import { registerShopRoutes } from "./shop-routes.js";
import { registerMinesDiceRoutes } from "./mines-dice-routes.js";
import { registerRollsRoutes, type RollsSqlListener } from "./rolls-routes.js";
import { registerStreamDonationRoutes } from "./stream-donation-routes.js";
import { registerStreamStreakRoutes } from "./stream-streak-routes.js";
import { registerTaskRoutes } from "./task-routes.js";
import {
  createDefaultSubmissionStorage,
  registerWelvuraRoutes,
} from "./welvura-routes.js";
import type { WebhookSecrets } from "./webhook-routes.js";
import { registerWebhookRoutes } from "./webhook-routes.js";

export type ApiAppOptions = {
  db?: AuthDatabase;
  sql?: RollsSqlListener;
  authPolicy?: AuthPolicy;
  webhook?: WebhookSecrets;
  kickOAuth?: KickOAuthConfig;
  rateLimitPolicy?: RateLimitPolicy;
  userRateLimiter?: RateLimiter;
  webhookRateLimiter?: RateLimiter;
  metrics?: Metrics;
  logger?: StructuredLogger;
  /** When true, POST /dev/auth is live. main.ts never sets this in production. */
  allowDevAuth?: boolean;
  /** Bot username for referral deep links; defaults to giftbot in routes. */
  telegramBotUsername?: string;
  submissionStorage?: SubmissionFileStorage;
  /** Persistent upload root for Welvura screenshots. */
  uploadDir?: string;
  /** Fastify trustProxy (one hop behind nginx → "1"). */
  trustProxy?: boolean | string;
  /** Allowed browser origins; empty means no CORS headers (same-origin nginx). */
  corsOrigins?: string[];
  /** OBS overlay secret. Never sent to Mini App. */
  overlayAlertsToken?: string;
};

export function createApiApp(options: ApiAppOptions = {}) {
  const fastifyOpts: {
    logger: false;
    bodyLimit: number;
    trustProxy?: boolean | string;
  } = {
    logger: false,
    bodyLimit: 256 * 1024,
  };
  if (options.trustProxy !== undefined) {
    fastifyOpts.trustProxy = options.trustProxy;
  }
  const app = Fastify(fastifyOpts);
  const ratePolicy = options.rateLimitPolicy ?? createRateLimitPolicy();
  const userRateLimiter =
    options.userRateLimiter ??
    createTieredMemoryRateLimiter({
      windowSeconds: ratePolicy.windowSeconds,
      readMaxRequests: ratePolicy.maxRequests,
      writeMaxRequests: ratePolicy.writeMaxRequests,
      authMaxRequests: ratePolicy.authMaxRequests,
    });
  const webhookRateLimiter =
    options.webhookRateLimiter ??
    createMemoryRateLimiter({
      windowSeconds: ratePolicy.windowSeconds,
      maxRequests: ratePolicy.webhookMaxRequests,
    });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    // Telegram Mini App embeds the page; do not set X-Frame-Options / CSP frame-ancestors.
    return payload;
  });

  const corsOrigins = options.corsOrigins ?? [];
  if (corsOrigins.length > 0) {
    app.addHook("onRequest", async (request, reply) => {
      const origin = request.headers.origin;
      if (origin && corsOrigins.includes(origin)) {
        reply.header("access-control-allow-origin", origin);
        reply.header("vary", "Origin");
        reply.header("access-control-allow-credentials", "true");
        reply.header(
          "access-control-allow-headers",
          "authorization, content-type, idempotency-key",
        );
        reply.header(
          "access-control-allow-methods",
          "GET,POST,PATCH,DELETE,OPTIONS",
        );
      }
      if (request.method === "OPTIONS") {
        return reply.code(204).send();
      }
    });
  }

  const { metrics } = registerObservability(app, {
    ...(options.metrics ? { metrics: options.metrics } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });
  registerHealthRoutes(app, options.db, metrics);

  if (options.db && options.authPolicy) {
    registerAuthRoutes(app, options.db, options.authPolicy, userRateLimiter);
    if (options.allowDevAuth) {
      registerDevAuthRoutes(app, options.db, options.authPolicy);
    } else {
      registerDevAuthDisabled(app);
    }
    registerAdminRoutes(app, options.db, userRateLimiter);
    registerBroadcastRoutes(
      app,
      options.db,
      userRateLimiter,
      options.uploadDir
        ? createBroadcastImageStorage(options.uploadDir)
        : undefined,
    );
    registerBootstrapRoute(app, options.db, userRateLimiter);
    registerProfileRoutes(app, options.db, userRateLimiter);
    registerPromoRoutes(app, options.db, userRateLimiter);
    registerGramRoutes(app, options.db, userRateLimiter);
    registerCashRoutes(app, options.db, userRateLimiter);
    registerFreeCaseRoutes(app, options.db, userRateLimiter);
    registerPaidCaseRoutes(app, options.db, userRateLimiter);
    registerReferralRoutes(app, options.db, userRateLimiter, {
      ...(options.telegramBotUsername
        ? { botUsername: options.telegramBotUsername }
        : {}),
    });
    registerContestRoutes(app, options.db, userRateLimiter, {
      ...(options.telegramBotUsername
        ? { botUsername: options.telegramBotUsername }
        : {}),
    });
    registerLeaderboardRoutes(app, options.db, userRateLimiter);
    registerShopRoutes(app, options.db, userRateLimiter);
    registerStreamDonationRoutes(
      app,
      options.db,
      userRateLimiter,
      options.overlayAlertsToken ?? process.env.STREAM_ALERTS_TOKEN,
    );
    registerGiveawayRoutes(
      app,
      options.db,
      userRateLimiter,
      options.uploadDir
        ? createGiveawayImageStorage(options.uploadDir)
        : undefined,
    );
    registerAchievementRoutes(app, options.db, userRateLimiter);
    registerTaskRoutes(app, options.db, userRateLimiter);
    registerStreamStreakRoutes(app, options.db, userRateLimiter);
    registerMinesDiceRoutes(app, options.db, userRateLimiter);
    registerRollsRoutes(app, options.db, userRateLimiter, options.sql);
    registerWelvuraRoutes(
      app,
      options.db,
      options.submissionStorage ??
        createDefaultSubmissionStorage(options.uploadDir),
      userRateLimiter,
    );
    registerSectionRoutes(app, options.db, userRateLimiter);
    registerEconomyRoutes(app, options.db, userRateLimiter);
    registerKickOAuthRoutes(
      app,
      options.db,
      options.kickOAuth,
      userRateLimiter,
    );
    registerWebhookRoutes(
      app,
      options.db,
      options.webhook ?? {},
      webhookRateLimiter,
    );
    app.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?")[0] ?? "";
      if (
        request.method !== "POST" ||
        (path !== "/auth/telegram" && path !== "/admin/auth")
      ) {
        return;
      }
      request.rateLimit = { bucket: "auth", keyType: "ip" };
      const decision = await userRateLimiter.consume(`auth:ip:${request.ip}`);
      if (!decision.allowed) {
        reply.header("retry-after", String(decision.retryAfterSeconds));
        return reply.code(429).send({
          error: "RATE_LIMITED",
          message: "too many requests",
        });
      }
    });
  } else {
    registerDevAuthDisabled(app);
  }

  return app;
}
