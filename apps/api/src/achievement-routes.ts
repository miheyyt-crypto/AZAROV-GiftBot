import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import { listAchievementsForUser } from "@giftbot/domain";
import type { RateLimiter } from "@giftbot/rate-limit";
import type { FastifyInstance } from "fastify";
import { sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";


export function registerAchievementRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/achievements", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "achievements", session.userId);
      const items = await listAchievementsForUser(db, session.userId);
      return { items };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
