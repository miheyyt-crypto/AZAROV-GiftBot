import {
  AuthError,
  authenticateAdmin,
  authenticateMiniApp,
  logoutAdminSession,
  logoutMiniAppSession,
  resolveMiniAppSession,
  touchMiniAppSessionLastUsed,
  type AuthDatabase,
  type AuthPolicy,
} from "@giftbot/auth";
import type { RateLimiter } from "@giftbot/rate-limit";
import type { FastifyInstance, FastifyReply } from "fastify";
import { sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";

function readInitData(body: unknown): string {
  if (
    typeof body !== "object" ||
    body === null ||
    !("initData" in body) ||
    typeof body.initData !== "string" ||
    body.initData.length === 0
  ) {
    throw new AuthError("BAD_REQUEST", "initData is required", 400);
  }
  return body.initData;
}

function readBearerToken(header: string | undefined): string {
  if (!header) {
    throw new AuthError("UNAUTHORIZED", "bearer token is required", 401);
  }
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AuthError("UNAUTHORIZED", "bearer token is required", 401);
  }
  return token;
}

function sendAuthError(reply: FastifyReply, error: unknown): FastifyReply {
  return sendHttpError(reply, error);
}

function authResultBody(result: {
  token: string;
  expiresAt: Date;
  user: { userId: string; publicId: string };
}) {
  return {
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
    user: result.user,
  };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  policy: AuthPolicy,
  limiter?: RateLimiter,
): void {
  app.post("/auth/telegram", async (request, reply) => {
    try {
      const result = await authenticateMiniApp(
        db,
        readInitData(request.body),
        policy,
      );
      return authResultBody(result);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/auth/presence", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearerToken(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "presence", session.userId);
      await touchMiniAppSessionLastUsed(db, session.sessionId);
      return reply.code(204).send();
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    try {
      await logoutMiniAppSession(db, readBearerToken(request.headers.authorization));
      return reply.code(204).send();
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/admin/auth", async (request, reply) => {
    try {
      const result = await authenticateAdmin(
        db,
        readInitData(request.body),
        policy,
      );
      return authResultBody(result);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/admin/logout", async (request, reply) => {
    try {
      await logoutAdminSession(db, readBearerToken(request.headers.authorization));
      return reply.code(204).send();
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });
}
