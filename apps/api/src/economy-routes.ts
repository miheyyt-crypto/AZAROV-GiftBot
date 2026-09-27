import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import {
  cases,
  games,
  products,
} from "@giftbot/db/schema";
import {
  playCatalogGame,
  purchaseProduct,
  payoutReferralReward,
  readAllowedBets,
  readGameRound,
} from "@giftbot/domain";
import { enqueueJob, JOB_TYPES, runIdempotentPost } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import { withRequestCorrelation } from "./observability.js";

const FORBIDDEN_CLIENT_RESULT_KEYS = [
  "result",
  "prize",
  "prizeMinor",
  "draw",
  "seed",
  "rng",
  "outcome",
] as const;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readIdempotencyKey(headers: Record<string, string | string[] | undefined>): string {
  const key = headerValue(headers["idempotency-key"]);
  if (!key) {
    throw new ApiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  }
  return key;
}

function rejectClientResult(body: unknown): Record<string, unknown> {
  const row = asRecord(body) ?? {};
  for (const key of FORBIDDEN_CLIENT_RESULT_KEYS) {
    if (key in row) {
      throw new ApiError("BAD_REQUEST", "client cannot set game result", 400);
    }
  }
  return row;
}

function readBetAmountMinor(body: Record<string, unknown>): bigint {
  const raw = body.betAmountMinor;
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new ApiError("BAD_REQUEST", "betAmountMinor is required", 400);
  }
  try {
    const amount = typeof raw === "bigint" ? raw : BigInt(raw);
    if (amount <= 0n) {
      throw new Error("non-positive");
    }
    return amount;
  } catch {
    throw new ApiError("BAD_REQUEST", "betAmountMinor is invalid", 400);
  }
}

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
}


function publicGame(row: typeof games.$inferSelect) {
  let allowedBetMinor: string[] = [];
  try {
    allowedBetMinor = (readAllowedBets(row.config) ?? []).map((amount) =>
      amount.toString(),
    );
  } catch {
    allowedBetMinor = [];
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    settlementMode: row.settlementMode,
    allowedBetMinor,
  };
}

export function registerEconomyRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/games", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "games", session.userId);
      const rows = await db.select().from(games).where(eq(games.status, "active"));
      return { games: rows.map(publicGame) };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/games/:gameId", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(db, readBearer(request.headers.authorization));
      await consumeAuthed(limiter, request, reply, "games", session.userId);
      const gameId = (request.params as { gameId: string }).gameId;
      const rows = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
      const game = rows[0];
      if (!game || game.status !== "active") {
        throw new ApiError("NOT_FOUND", "game not found", 404);
      }
      return publicGame(game);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/rounds/:roundId", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "rounds", session.userId);
      const roundId = (request.params as { roundId: string }).roundId;
      return await readGameRound(db, { roundId, userId: session.userId });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/games/:gameId/play", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "play", session.userId);
      const gameId = (request.params as { gameId: string }).gameId;
      const body = rejectClientResult(request.body);
      const betAmountMinor = readBetAmountMinor(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: "POST /games/:gameId/play",
          key: idempotencyKey,
          requestHash: requestHash({ gameId, betAmountMinor: betAmountMinor.toString() }),
        },
        async () => {
          const played = await withRequestCorrelation(request, () =>
            playCatalogGame(db, {
              gameId,
              userId: session.userId,
              betAmountMinor,
              idempotencyKey,
            }),
          );
          if (played.status === "pending") {
            await enqueueJob(db, {
              type: JOB_TYPES.gameSettleAsync,
              idempotencyKey: `game.settle_async:${played.roundId}`,
              payload: { round_id: played.roundId },
              ...(request.correlation?.correlationId
                ? { correlationId: request.correlation.correlationId }
                : {}),
            });
          }
          return {
            status: 200,
            body: {
              roundId: played.roundId,
              status: played.status,
              replayed: played.replayed,
              ...(played.resultPayload ? { result: played.resultPayload } : {}),
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/cases", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(db, readBearer(request.headers.authorization));
      await consumeAuthed(limiter, request, reply, "cases", session.userId);
      const rows = await db.select().from(cases).where(eq(cases.status, "active"));
      return {
        cases: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          ...(row.priceMinor !== null ? { priceMinor: row.priceMinor.toString() } : {}),
        })),
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/products", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(db, readBearer(request.headers.authorization));
      await consumeAuthed(limiter, request, reply, "products", session.userId);
      const rows = await db.select().from(products).where(eq(products.status, "active"));
      return {
        products: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          type: row.type,
          ...(row.priceMinor !== null ? { priceMinor: row.priceMinor.toString() } : {}),
        })),
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/products/:productId/purchase", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "products", session.userId);
      rejectClientResult(request.body);
      const productId = (request.params as { productId: string }).productId;
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: "POST /products/:productId/purchase",
          key: idempotencyKey,
          requestHash: requestHash({ productId }),
        },
        async () => {
          const bought = await purchaseProduct(db, {
            userId: session.userId,
            productId,
            idempotencyKey,
          });
          return {
            status: 200,
            body: {
              purchaseId: bought.purchaseId,
              status: bought.status,
              replayed: bought.replayed,
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/referrals/payout", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(db, readBearer(request.headers.authorization));
      await consumeAuthed(limiter, request, reply, "referrals", session.userId);
      await payoutReferralReward();
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
