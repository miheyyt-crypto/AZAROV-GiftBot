import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import {
  clampProfileListLimit,
  decodeProfileCursor,
  getFreeCaseStatus,
  isPaidCaseCode,
  listFreeCaseHistory,
  listPaidCaseHistory,
  listReferralCaseHistory,
  listRecentWins,
  openFreeCase,
  REFERRAL_CASE_CODE,
} from "@giftbot/domain";
import { runIdempotentPost } from "@giftbot/jobs";
import { createLogger } from "@giftbot/observability";
import type { RateLimiter } from "@giftbot/rate-limit";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import { withRequestCorrelation } from "./observability.js";

const freeCaseLogger = createLogger("api.free-case");

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


function rejectInjectedResult(body: Record<string, unknown>): void {
  const forbidden = [
    "result",
    "reward",
    "rarity",
    "chance",
    "itemId",
    "itemCode",
    "seed",
    "rng",
    "weight",
    "realChance",
  ];
  for (const key of forbidden) {
    if (key in body) {
      throw new ApiError("BAD_REQUEST", "client result fields are not allowed", 400);
    }
  }
}

export function registerFreeCaseRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/cases/free", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "cases", session.userId);
      return getFreeCaseStatus(db, { userId: session.userId });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/cases/free/open", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "cases", session.userId);
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: "POST /cases/free/open",
          key: idempotencyKey,
          requestHash: requestHash({}),
        },
        async () => {
          const started = Date.now();
          const opened = await withRequestCorrelation(request, () =>
            openFreeCase(db, {
              userId: session.userId,
              idempotencyKey,
            }),
          );
          freeCaseLogger.info("free case opened", {
            openingId: opened.openingId,
            itemCode: opened.result.itemCode,
            rarity: opened.result.rarity,
            rewardType: opened.result.rewardType,
            durationMs: Date.now() - started,
            replayed: opened.replayed,
          });
          return {
            status: 200,
            body: opened,
          };
        },
      );
      return reply.code(result.status).send({
        ...result.body,
        replayed: result.replayed,
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/cases/history", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "cases", session.userId);
      const query = request.query as Record<string, unknown>;
      const caseCode =
        typeof query.caseCode === "string" && query.caseCode.length > 0
          ? query.caseCode
          : "free";
      if (
        caseCode !== "free" &&
        caseCode !== REFERRAL_CASE_CODE &&
        !isPaidCaseCode(caseCode)
      ) {
        throw new ApiError(
          "BAD_REQUEST",
          "caseCode must be free|poor|medium|blatnoy|referral",
          400,
        );
      }
      const rawLimit = query.limit;
      const limit =
        typeof rawLimit === "string" || typeof rawLimit === "number"
          ? clampProfileListLimit(
              typeof rawLimit === "number" ? rawLimit : Number(rawLimit),
            )
          : clampProfileListLimit(undefined);
      const rawCursor = query.cursor;
      let cursor;
      if (typeof rawCursor === "string" && rawCursor.length > 0) {
        cursor = decodeProfileCursor(rawCursor);
        if (!cursor) {
          throw new ApiError("BAD_REQUEST", "cursor is invalid", 400);
        }
      }
      if (caseCode === REFERRAL_CASE_CODE) {
        return listReferralCaseHistory(db, {
          userId: session.userId,
          limit,
          ...(cursor ? { cursor } : {}),
        });
      }
      if (isPaidCaseCode(caseCode)) {
        return listPaidCaseHistory(db, {
          userId: session.userId,
          caseCode,
          limit,
          ...(cursor ? { cursor } : {}),
        });
      }
      return listFreeCaseHistory(db, {
        userId: session.userId,
        limit,
        ...(cursor ? { cursor } : {}),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/recent-wins", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "recent-wins", session.userId);
      const query = request.query as Record<string, unknown>;
      const rawLimit = query.limit;
      const parsed =
        typeof rawLimit === "string" || typeof rawLimit === "number"
          ? Number(rawLimit)
          : NaN;
      return listRecentWins(
        db,
        Number.isFinite(parsed) ? { limit: parsed } : {},
      );
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
