import type { AuthDatabase } from "@giftbot/auth";
import { resolveMiniAppSession } from "@giftbot/auth";
import {
  clampProfileListLimit,
  decodeProfileCursor,
  readProfileInventory,
  readProfileLedger,
  readProfileNotifications,
  readProfileOrders,
  readProfileSummary,
  type OrderReadStatus,
} from "@giftbot/domain";
import type { RateLimiter } from "@giftbot/rate-limit";
import type { FastifyInstance } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed } from "./http-limit.js";
import { readBearer } from "./http-auth.js";

const ORDER_STATUSES = new Set<OrderReadStatus>([
  "pending",
  "processing",
  "fulfilled",
  "rejected",
]);


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

function readListQuery(query: Record<string, unknown>) {
  const cursor = readCursor(query);
  return {
    limit: readLimit(query),
    ...(cursor ? { cursor } : {}),
  };
}

function readOrderStatus(query: Record<string, unknown>): OrderReadStatus | undefined {
  const raw = query.status;
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string" || !ORDER_STATUSES.has(raw as OrderReadStatus)) {
    throw new ApiError("BAD_REQUEST", "status is invalid", 400);
  }
  return raw as OrderReadStatus;
}

export function registerProfileRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/profile", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "profile", session.userId);
      return await readProfileSummary(db, session.userId);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/profile/notifications", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "profile", session.userId);
      const query = request.query as Record<string, unknown>;
      return await readProfileNotifications(db, {
        userId: session.userId,
        ...readListQuery(query),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/profile/ledger", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "profile", session.userId);
      const query = request.query as Record<string, unknown>;
      return await readProfileLedger(db, {
        userId: session.userId,
        ...readListQuery(query),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/profile/inventory", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "profile", session.userId);
      const query = request.query as Record<string, unknown>;
      return await readProfileInventory(db, {
        userId: session.userId,
        ...readListQuery(query),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/profile/orders", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "profile", session.userId);
      const query = request.query as Record<string, unknown>;
      const status = readOrderStatus(query);
      return await readProfileOrders(db, {
        userId: session.userId,
        ...readListQuery(query),
        ...(status ? { status } : {}),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
