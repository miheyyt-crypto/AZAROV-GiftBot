import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import {
  clampProfileListLimit,
  decodeProfileCursor,
  getReferralCaseCatalog,
  listReferralsForUser,
  openReferralCase,
  readReferralMe,
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

const referralLogger = createLogger("api.referral");

const DEFAULT_BOT_USERNAME = "giftbot";

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
    "price",
    "priceAzc",
    "result",
    "reward",
    "rewardType",
    "rewardAmount",
    "chance",
    "displayChance",
    "realChance",
    "item",
    "itemId",
    "itemCode",
    "userId",
    "seed",
    "rng",
    "weight",
  ];
  for (const key of forbidden) {
    if (key in body) {
      throw new ApiError("BAD_REQUEST", "client result fields are not allowed", 400);
    }
  }
}

function readLimit(query: Record<string, unknown>): number {
  const raw = query.limit;
  if (typeof raw !== "string" && typeof raw !== "number") {
    return clampProfileListLimit(undefined);
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return clampProfileListLimit(parsed);
}

function readCursor(query: Record<string, unknown>) {
  const raw = query.cursor;
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }
  const cursor = decodeProfileCursor(raw);
  if (!cursor) {
    throw new ApiError("BAD_REQUEST", "cursor is invalid", 400);
  }
  return cursor;
}

export type ReferralRoutesOptions = {
  botUsername?: string;
};

export function registerReferralRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
  options: ReferralRoutesOptions = {},
): void {
  const botUsername = options.botUsername?.trim() || DEFAULT_BOT_USERNAME;

  app.get("/referrals/me", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "referrals", session.userId);
      return await readReferralMe(db, {
        userId: session.userId,
        botUsername,
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/referrals", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "referrals", session.userId);
      const query = request.query as Record<string, unknown>;
      const cursor = readCursor(query);
      return await listReferralsForUser(db, {
        userId: session.userId,
        limit: readLimit(query),
        ...(cursor ? { cursor } : {}),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/cases/referral", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "cases", session.userId);
      const me = await readReferralMe(db, {
        userId: session.userId,
        botUsername,
      });
      return {
        ...getReferralCaseCatalog(),
        availableCases: me.caseProgress.availableCases,
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/cases/referral/open", async (request, reply) => {
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
          route: "POST /cases/referral/open",
          key: idempotencyKey,
          requestHash: requestHash({}),
        },
        async () => {
          const started = Date.now();
          const opened = await withRequestCorrelation(request, () =>
            openReferralCase(db, {
              userId: session.userId,
              idempotencyKey,
            }),
          );
          referralLogger.info("referral_case_open_success", {
            caseCode: opened.caseCode,
            rewardType: opened.result.rewardType,
            itemCode: opened.result.itemCode,
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
}
