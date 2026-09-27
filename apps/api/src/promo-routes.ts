import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  ForbiddenError,
  resolveMiniAppSession,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  clampProfileListLimit,
  createPromoCode,
  deactivatePromoCode,
  decodeProfileCursor,
  listPromoCodes,
  redeemPromoCode,
} from "@giftbot/domain";
import { runIdempotentPost } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed, consumeIp } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import { withRequestCorrelation } from "./observability.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

function publicPromo(row: {
  id: string;
  code: string;
  rewardAzc: string;
  activationLimit: number;
  activationCount: number;
  status: "active" | "inactive";
  createdAt: string;
  deactivatedAt: string | null;
}) {
  return {
    id: row.id,
    code: row.code,
    reward: row.rewardAzc,
    used: row.activationCount,
    limit: row.activationLimit,
    status: row.status,
    createdAt: row.createdAt,
    deactivatedAt: row.deactivatedAt,
  };
}


async function requireSuperAdmin(
  db: AuthDatabase,
  authorization: string | undefined,
  permission: string,
) {
  const admin = await authorizeAdmin(db, readBearer(authorization), permission);
  if (!admin.roles.includes("super_admin")) {
    throw new ForbiddenError("super_admin is required");
  }
  return admin;
}

function readPromoId(params: { promoCodeId?: string }): string {
  const promoCodeId = params.promoCodeId ?? "";
  if (!UUID_RE.test(promoCodeId)) {
    throw new ApiError("BAD_REQUEST", "promo id is invalid", 400);
  }
  return promoCodeId;
}

function readRedeemBody(body: unknown): { code: unknown } {
  const row = asRecord(body) ?? {};
  return { code: row.code };
}

function readCreateBody(body: unknown): {
  code: unknown;
  rewardAzc: unknown;
  activationLimit: unknown;
} {
  const row = asRecord(body) ?? {};
  return {
    code: row.code,
    rewardAzc: row.rewardAzc,
    activationLimit: row.activationLimit,
  };
}

function readListQuery(query: Record<string, unknown>) {
  const rawLimit = query.limit;
  const limit =
    typeof rawLimit === "string" || typeof rawLimit === "number"
      ? clampProfileListLimit(
          typeof rawLimit === "number" ? rawLimit : Number(rawLimit),
        )
      : clampProfileListLimit(undefined);
  const rawCursor = query.cursor;
  if (typeof rawCursor !== "string" || rawCursor.length === 0) {
    return { limit };
  }
  const cursor = decodeProfileCursor(rawCursor);
  if (!cursor) {
    throw new ApiError("BAD_REQUEST", "cursor is invalid", 400);
  }
  return { limit, cursor };
}

export function registerPromoRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.post("/promo/redeem", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "promo", session.userId);
      const body = readRedeemBody(request.body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: "POST /promo/redeem",
          key: idempotencyKey,
          requestHash: requestHash({ code: body.code }),
        },
        async () => {
          const redeemed = await withRequestCorrelation(request, () =>
            redeemPromoCode(db, {
              userId: session.userId,
              code: body.code,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: {
              status: redeemed.status,
              rewardAzc: redeemed.rewardAzc,
              newBalanceAzc: redeemed.newBalanceAzc,
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/promo-codes", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.promoRead,
      );
      const listed = await listPromoCodes(
        db,
        readListQuery(request.query as Record<string, unknown>),
      );
      return {
        items: listed.items.map(publicPromo),
        nextCursor: listed.nextCursor,
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/promo-codes", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.promoWrite,
      );
      const body = readCreateBody(request.body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/promo-codes",
          key: idempotencyKey,
          requestHash: requestHash({
            code: body.code,
            rewardAzc: body.rewardAzc,
            activationLimit: body.activationLimit,
          }),
        },
        async () => {
          const created = await withRequestCorrelation(request, () =>
            createPromoCode(db, {
              code: body.code,
              rewardAzc: body.rewardAzc,
              activationLimit: body.activationLimit,
              adminUserId: admin.userId,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: {
              ...publicPromo(created.promo),
              auditId: created.auditId,
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/promo-codes/:promoCodeId/deactivate", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.promoWrite,
      );
      const promoCodeId = readPromoId(
        request.params as { promoCodeId?: string },
      );
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/promo-codes/:promoCodeId/deactivate",
          key: idempotencyKey,
          requestHash: requestHash({ promoCodeId }),
        },
        async () => {
          const deactivated = await withRequestCorrelation(request, () =>
            deactivatePromoCode(db, {
              promoCodeId,
              adminUserId: admin.userId,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: {
              ...publicPromo(deactivated.promo),
              replayed: deactivated.replayed,
              ...(deactivated.auditId ? { auditId: deactivated.auditId } : {}),
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
