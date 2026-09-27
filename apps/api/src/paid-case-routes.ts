import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import {
  isPaidCaseCode,
  listPaidCaseCatalog,
  openPaidCase,
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

const paidCaseLogger = createLogger("api.paid-case");

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

export function registerPaidCaseRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/cases/paid", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "cases", session.userId);
      return { items: listPaidCaseCatalog() };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/cases/:caseCode/open", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "cases", session.userId);
      const params = request.params as { caseCode?: string };
      const caseCode = params.caseCode ?? "";
      if (!isPaidCaseCode(caseCode)) {
        throw new ApiError("CASE_NOT_FOUND", "paid case not found", 404);
      }
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: `POST /cases/${caseCode}/open`,
          key: idempotencyKey,
          requestHash: requestHash({ caseCode }),
        },
        async () => {
          const started = Date.now();
          const opened = await withRequestCorrelation(request, () =>
            openPaidCase(db, {
              userId: session.userId,
              caseCode,
              idempotencyKey,
            }),
          );
          paidCaseLogger.info("paid_case_open_success", {
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
