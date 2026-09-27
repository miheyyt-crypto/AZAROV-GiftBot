import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import {
  cashoutMinesGame,
  getActiveMinesGame,
  listDiceHistory,
  listMinesHistory,
  playDice,
  revealMinesCell,
  startMinesGame,
} from "@giftbot/domain";
import { runIdempotentPost } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import { withNewBalanceAzc } from "./wallet-read.js";

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readIdempotencyKey(
  headers: Record<string, string | string[] | undefined>,
): string {
  const key = headerValue(headers["idempotency-key"]);
  if (!key) {
    throw new ApiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  }
  return key;
}

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
}


const FORBIDDEN_RESULT_KEYS = [
  "payout",
  "payoutAzc",
  "result",
  "multiplier",
  "minePositions",
  "minesPositions",
  "win",
  "rawResult",
  "serverSeed",
  "forceWin",
] as const;

function rejectInjectedResult(body: Record<string, unknown>): void {
  for (const key of FORBIDDEN_RESULT_KEYS) {
    if (key in body) {
      throw new ApiError("BAD_REQUEST", "client result fields are not allowed", 400);
    }
  }
}

export function registerMinesDiceRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/games/mines/active", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "mines", session.userId);
      const game = await getActiveMinesGame(db, session.userId);
      return { game };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/games/mines/history", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "mines", session.userId);
      const query = asRecord(request.query) ?? {};
      const cursor = typeof query.cursor === "string" ? query.cursor : null;
      return listMinesHistory(db, {
        userId: session.userId,
        ...(cursor ? { cursor } : {}),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/games/mines/start", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "mines", session.userId);
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: "POST /games/mines/start",
          key: idempotencyKey,
          requestHash: requestHash(body),
        },
        async () => {
          const started = await startMinesGame(db, {
            userId: session.userId,
            betAzc: body.betAzc,
            mines: body.mines,
            clientSeed: body.clientSeed,
            idempotencyKey,
          });
          return { status: 200, body: started };
        },
      );
      const responseBody = asRecord(result.body) ?? {};
      return reply
        .code(result.status)
        .send(await withNewBalanceAzc(db, session.userId, responseBody));
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/games/mines/:gameId/reveal", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "mines", session.userId);
      const params = asRecord(request.params) ?? {};
      const gameId = typeof params.gameId === "string" ? params.gameId : "";
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: `POST /games/mines/${gameId}/reveal`,
          key: idempotencyKey,
          requestHash: requestHash(body),
        },
        async () => {
          const revealed = await revealMinesCell(db, {
            userId: session.userId,
            gameId,
            cell: body.cell,
            idempotencyKey,
          });
          return { status: 200, body: revealed };
        },
      );
      const responseBody = asRecord(result.body) ?? {};
      return reply
        .code(result.status)
        .send(await withNewBalanceAzc(db, session.userId, responseBody));
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/games/mines/:gameId/cashout", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "mines", session.userId);
      const params = asRecord(request.params) ?? {};
      const gameId = typeof params.gameId === "string" ? params.gameId : "";
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: `POST /games/mines/${gameId}/cashout`,
          key: idempotencyKey,
          requestHash: requestHash(body),
        },
        async () => {
          const cashed = await cashoutMinesGame(db, {
            userId: session.userId,
            gameId,
            idempotencyKey,
          });
          return { status: 200, body: cashed };
        },
      );
      const responseBody = asRecord(result.body) ?? {};
      return reply
        .code(result.status)
        .send(await withNewBalanceAzc(db, session.userId, responseBody));
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/games/dice/history", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "dice", session.userId);
      const query = asRecord(request.query) ?? {};
      const cursor = typeof query.cursor === "string" ? query.cursor : null;
      return listDiceHistory(db, {
        userId: session.userId,
        ...(cursor ? { cursor } : {}),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/games/dice/play", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "dice", session.userId);
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: "POST /games/dice/play",
          key: idempotencyKey,
          requestHash: requestHash(body),
        },
        async () => {
          const played = await playDice(db, {
            userId: session.userId,
            betAzc: body.betAzc,
            chance: body.chance,
            clientSeed: body.clientSeed,
            idempotencyKey,
          });
          return { status: 200, body: played };
        },
      );
      const responseBody = asRecord(result.body) ?? {};
      return reply
        .code(result.status)
        .send(await withNewBalanceAzc(db, session.userId, responseBody));
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
