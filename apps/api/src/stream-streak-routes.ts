import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import { readStreamStreakState } from "@giftbot/domain";
import type { RateLimiter } from "@giftbot/rate-limit";
import type { FastifyInstance } from "fastify";
import { sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";


export function registerStreamStreakRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/stream-streak", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "stream-streak", session.userId);
      return readStreamStreakState(db, session.userId);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
