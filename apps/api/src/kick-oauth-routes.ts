import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import {
  buildKickAuthorizationUrl,
  consumeKickOAuthState,
  createKickOAuthState,
  encryptSecret,
  linkKickAccount,
  onKickAccountLinked,
  type KickOAuthClient,
} from "@giftbot/domain";
import type { RateLimiter } from "@giftbot/rate-limit";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";

export type KickOAuthConfig = {
  clientId: string;
  redirectUri: string;
  encryptionKey: Buffer;
  client: KickOAuthClient;
  stateTtlSeconds?: number;
  scope?: string;
};

function queryValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}


export function registerKickOAuthRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  config: KickOAuthConfig | undefined,
  limiter?: RateLimiter,
): void {
  app.post("/kick/oauth/start", async (request, reply) => {
    try {
      if (!config) {
        throw new ApiError("NOT_READY", "kick oauth is not configured", 503);
      }
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "kick-oauth", session.userId);
      const created = await createKickOAuthState(db, {
        userId: session.userId,
        ...(config.stateTtlSeconds !== undefined
          ? { ttlSeconds: config.stateTtlSeconds }
          : {}),
      });
      return {
        authorizationUrl: buildKickAuthorizationUrl({
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          state: created.state,
          codeChallenge: created.codeChallenge,
          ...(config.scope !== undefined ? { scope: config.scope } : {}),
        }),
        expiresAt: created.expiresAt.toISOString(),
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/kick/oauth/callback", async (request, reply) => {
    try {
      if (!config) {
        throw new ApiError("NOT_READY", "kick oauth is not configured", 503);
      }
      const query = request.query as Record<string, unknown>;
      const denied = queryValue(query.error);
      if (denied) {
        throw new ApiError("BAD_REQUEST", "kick oauth was denied", 400);
      }
      const code = queryValue(query.code);
      const state = queryValue(query.state);
      if (!code || !state) {
        throw new ApiError("BAD_REQUEST", "kick oauth code and state are required", 400);
      }

      const consumed = await consumeKickOAuthState(db, state);
      const tokens = await config.client.exchangeAuthorizationCode({
        code,
        codeVerifier: consumed.codeVerifier,
        redirectUri: config.redirectUri,
      });
      await linkKickAccount(db, {
        userId: consumed.userId,
        kickUserId: tokens.kickUserId,
        accessTokenEncrypted: encryptSecret(config.encryptionKey, tokens.accessToken),
        ...(tokens.refreshToken
          ? {
              refreshTokenEncrypted: encryptSecret(
                config.encryptionKey,
                tokens.refreshToken,
              ),
            }
          : {}),
        ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
        ...(tokens.username ? { username: tokens.username } : {}),
        ...(tokens.displayName ? { displayName: tokens.displayName } : {}),
        ...(tokens.avatarUrl ? { avatarUrl: tokens.avatarUrl } : {}),
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      });
      await onKickAccountLinked(db, consumed.userId);
      return { ok: true as const, kickLinked: true as const };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
