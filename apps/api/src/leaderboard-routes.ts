import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import {
  listBalanceLeaderboard,
  listReferralLeaderboard,
  type BalanceLeaderboardEntry,
  type ReferralLeaderboardEntry,
} from "@giftbot/domain";
import type { RateLimiter } from "@giftbot/rate-limit";
import type { FastifyInstance } from "fastify";
import { sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";

type PublicBalanceRow = {
  rank: number;
  publicId: string | null;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  balanceAzc: string;
  isYou: boolean;
};

type PublicReferralRow = {
  rank: number;
  publicId: string | null;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  activeReferrals: number;
  isYou: boolean;
};

function publicBalance(row: BalanceLeaderboardEntry): PublicBalanceRow {
  return {
    rank: row.rank,
    publicId: row.publicId,
    displayName: row.displayName,
    username: row.username,
    avatarUrl: row.avatarUrl,
    balanceAzc: row.balanceAzc,
    isYou: row.isYou,
  };
}

function publicReferral(row: ReferralLeaderboardEntry): PublicReferralRow {
  return {
    rank: row.rank,
    publicId: row.publicId,
    displayName: row.displayName,
    username: row.username,
    avatarUrl: row.avatarUrl,
    activeReferrals: row.activeReferrals,
    isYou: row.isYou,
  };
}


export function registerLeaderboardRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/leaderboard/balance", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "leaderboard", session.userId);
      const board = await listBalanceLeaderboard(db, {
        userId: session.userId,
      });
      return {
        items: board.items.map(publicBalance),
        self: board.self ? publicBalance(board.self) : null,
        serverTime: board.serverTime,
        generatedAt: board.serverTime,
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/leaderboard/referrals", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "leaderboard", session.userId);
      const board = await listReferralLeaderboard(db, {
        userId: session.userId,
      });
      return {
        items: board.items.map(publicReferral),
        self: board.self ? publicReferral(board.self) : null,
        serverTime: board.serverTime,
        generatedAt: board.serverTime,
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
