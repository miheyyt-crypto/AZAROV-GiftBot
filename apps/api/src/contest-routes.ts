import { resolveMiniAppSession, type AuthDatabase } from "@giftbot/auth";
import {
  readReferralContestHomeSummary,
  readReferralMe,
} from "@giftbot/domain";
import type { RateLimiter } from "@giftbot/rate-limit";
import type { FastifyInstance } from "fastify";
import { sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";

export function registerContestRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
  options: { botUsername?: string } = {},
): void {
  const botUsername = options.botUsername ?? "giftbot";

  app.get("/contest/referral/summary", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "contest-summary", session.userId);
      const me = await readReferralMe(db, {
        userId: session.userId,
        botUsername,
      });
      return await readReferralContestHomeSummary(db, {
        userId: session.userId,
        referralUrl: me.referralUrl,
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
