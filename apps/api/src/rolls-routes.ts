import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import {
  getRollsProvablyFair,
  listRollsHistory,
  placeRollsBet,
  readRollsCurrent,
  recoverRollsRounds,
  ROLLS_NOTIFY_CHANNEL,
} from "@giftbot/domain";
import { runIdempotentPost } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import websocket from "@fastify/websocket";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import { shouldSkipRollsWsSnapshot } from "./rolls-ws-fanout.js";
import { withNewBalanceAzc } from "./wallet-read.js";

export type RollsSqlListener = {
  listen: (
    channel: string,
    callback: (payload: string) => void | Promise<void>,
  ) => Promise<unknown>;
};

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
  "totalPot",
  "totalPotAzc",
  "participantCount",
  "chance",
  "deadline",
  "bettingDeadline",
  "winner",
  "winnerUserId",
  "winnerParticipantId",
  "winningTicket",
  "payout",
  "payoutAzc",
  "serverSeed",
  "serverSeedHash",
  "roundStatus",
  "status",
  "userId",
  "forceWinner",
  "forceWin",
] as const;

function rejectInjectedResult(body: Record<string, unknown>): void {
  for (const key of FORBIDDEN_RESULT_KEYS) {
    if (key in body) {
      throw new ApiError("BAD_REQUEST", "client result fields are not allowed", 400);
    }
  }
}

type RollsSocket = {
  send: (data: string) => void;
  close: () => void;
  on: (event: "close" | "message", cb: (raw?: unknown) => void) => void;
  roundId?: string;
  roundVersion?: string;
};

export function registerRollsRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
  sql?: RollsSqlListener,
): void {
  const sockets = new Set<RollsSocket>();

  void app.register(async (scoped) => {
    await recoverRollsRounds(db);
    await scoped.register(websocket);

    scoped.get("/games/rolls/current", async (request, reply) => {
      try {
        const session = await resolveMiniAppSession(
          db,
          readBearer(request.headers.authorization),
        );
        await consumeAuthed(limiter, request, reply, "rolls:current", session.userId);
        return readRollsCurrent(db, session.userId);
      } catch (error) {
        return sendHttpError(reply, error);
      }
    });

    scoped.get("/games/rolls/history", async (request, reply) => {
      try {
        const session = await resolveMiniAppSession(
          db,
          readBearer(request.headers.authorization),
        );
        await consumeAuthed(limiter, request, reply, "rolls:history", session.userId);
        const query = asRecord(request.query) ?? {};
        const cursor = typeof query.cursor === "string" ? query.cursor : null;
        const limitRaw = query.limit;
        const limit =
          typeof limitRaw === "string" && /^\d+$/.test(limitRaw)
            ? Number(limitRaw)
            : undefined;
        return listRollsHistory(db, {
          userId: session.userId,
          ...(cursor ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
      } catch (error) {
        return sendHttpError(reply, error);
      }
    });

    scoped.get("/games/rolls/:roundId/provably-fair", async (request, reply) => {
      try {
        const session = await resolveMiniAppSession(
          db,
          readBearer(request.headers.authorization),
        );
        await consumeAuthed(limiter, request, reply, "rolls:pf", session.userId);
        const params = asRecord(request.params) ?? {};
        const roundId = typeof params.roundId === "string" ? params.roundId : "";
        if (!roundId) {
          throw new ApiError("BAD_REQUEST", "roundId is required", 400);
        }
        return getRollsProvablyFair(db, roundId);
      } catch (error) {
        return sendHttpError(reply, error);
      }
    });

    scoped.post("/games/rolls/bet", async (request, reply) => {
      try {
        const session = await resolveMiniAppSession(
          db,
          readBearer(request.headers.authorization),
        );
        await consumeAuthed(limiter, request, reply, "rolls:bet", session.userId);
        const body = asRecord(request.body) ?? {};
        rejectInjectedResult(body);
        const idempotencyKey = readIdempotencyKey(request.headers);
        const result = await runIdempotentPost(
          db,
          {
            userId: session.userId,
            route: "POST /games/rolls/bet",
            key: idempotencyKey,
            requestHash: requestHash(body),
          },
          async () => {
            const placed = await placeRollsBet(db, {
              userId: session.userId,
              amountAzc: body.amountAzc,
              clientSeed: body.clientSeed,
              idempotencyKey,
            });
            return { status: 200, body: placed };
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

    scoped.get(
      "/games/rolls/ws",
      { websocket: true },
      (socket: RollsSocket, request) => {
        void (async () => {
          try {
            const query = asRecord(request.query) ?? {};
            const token =
              typeof query.token === "string"
                ? query.token
                : readBearer(request.headers.authorization);
            const session = await resolveMiniAppSession(db, token);
            sockets.add(socket);
            const snap = await readRollsCurrent(db, session.userId);
            socket.roundId = snap.round.roundId;
            socket.roundVersion = snap.round.version;
            socket.send(
              JSON.stringify({
                type: "round_snapshot",
                roundId: snap.round.roundId,
                version: snap.round.version,
                serverTime: snap.serverTime,
                round: snap.round,
                you: snap.you,
                previous: snap.previous,
                top: snap.top,
              }),
            );
            socket.on("close", () => {
              sockets.delete(socket);
            });
            socket.on("message", (raw) => {
              const text = String(raw ?? "");
              if (text === "ping") {
                socket.send(JSON.stringify({ type: "pong" }));
              }
            });
          } catch {
            socket.close();
          }
        })();
      },
    );
  });

  if (sql) {
    void sql
      .listen(ROLLS_NOTIFY_CHANNEL, async () => {
        let snapshot: Awaited<ReturnType<typeof readRollsCurrent>>;
        try {
          snapshot = await readRollsCurrent(db);
        } catch {
          return;
        }
        const payload = JSON.stringify({
          type: "round_snapshot",
          roundId: snapshot.round.roundId,
          version: snapshot.round.version,
          serverTime: snapshot.serverTime,
          round: snapshot.round,
          previous: snapshot.previous,
          top: snapshot.top,
        });
        for (const socket of sockets) {
          if (
            shouldSkipRollsWsSnapshot(socket, {
              roundId: snapshot.round.roundId,
              version: snapshot.round.version,
            })
          ) {
            continue;
          }
          socket.roundId = snapshot.round.roundId;
          socket.roundVersion = snapshot.round.version;
          try {
            socket.send(payload);
          } catch {
            sockets.delete(socket);
          }
        }
      })
      .catch(() => undefined);
  }
}
