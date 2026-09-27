import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  ForbiddenError,
  resolveMiniAppSession,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  clampProfileListLimit,
  createCashItemWithdrawal,
  decodeProfileCursor,
  fulfillCashItemWithdrawal,
  listAdminCashItemWithdrawals,
  listUserCashItemWithdrawals,
  markCashItemWithdrawalProcessing,
  rejectCashItemWithdrawal,
  type CashItemWithdrawalRecord,
  type CashItemWithdrawalStatus,
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

const STATUSES = new Set<CashItemWithdrawalStatus | "all">([
  "all",
  "pending",
  "processing",
  "fulfilled",
  "rejected",
]);

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

function publicUserWithdrawal(row: CashItemWithdrawalRecord) {
  return {
    id: row.id,
    inventoryItemId: row.inventoryItemId,
    amountRub: row.amountRub,
    welvuraId: row.welvuraId,
    source: row.source,
    status: row.status,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    processingAt: row.processingAt,
    fulfilledAt: row.fulfilledAt,
    rejectedAt: row.rejectedAt,
  };
}

function publicAdminWithdrawal(row: CashItemWithdrawalRecord) {
  return {
    id: row.id,
    user: row.publicId,
    telegramUsername: row.telegramUsername,
    inventoryItemId: row.inventoryItemId,
    amountRub: row.amountRub,
    welvuraId: row.welvuraId,
    source: row.source,
    status: row.status,
    createdAt: row.createdAt,
    rejectionReason: row.rejectionReason,
    processedByAdminId: row.processedByAdminId,
    processingAt: row.processingAt,
    fulfilledAt: row.fulfilledAt,
    rejectedAt: row.rejectedAt,
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

function readWithdrawalId(params: { id?: string }): string {
  const id = params.id ?? "";
  if (!UUID_RE.test(id)) {
    throw new ApiError("BAD_REQUEST", "withdrawal id is invalid", 400);
  }
  return id;
}

function readItemId(params: { itemId?: string }): string {
  const id = params.itemId ?? "";
  if (!UUID_RE.test(id)) {
    throw new ApiError("BAD_REQUEST", "item id is invalid", 400);
  }
  return id;
}

function readListQuery(query: Record<string, unknown>) {
  const rawLimit = query.limit;
  const limit =
    typeof rawLimit === "string" || typeof rawLimit === "number"
      ? clampProfileListLimit(
          typeof rawLimit === "number" ? rawLimit : Number(rawLimit),
        )
      : clampProfileListLimit(undefined);
  const rawStatus = query.status;
  let status: CashItemWithdrawalStatus | "all" | undefined;
  if (typeof rawStatus === "string" && rawStatus.length > 0) {
    if (!STATUSES.has(rawStatus as CashItemWithdrawalStatus | "all")) {
      throw new ApiError("BAD_REQUEST", "status is invalid", 400);
    }
    status = rawStatus as CashItemWithdrawalStatus | "all";
  }
  const rawCursor = query.cursor;
  if (typeof rawCursor !== "string" || rawCursor.length === 0) {
    return {
      limit,
      ...(status ? { status } : {}),
    };
  }
  const cursor = decodeProfileCursor(rawCursor);
  if (!cursor) {
    throw new ApiError("BAD_REQUEST", "cursor is invalid", 400);
  }
  return {
    limit,
    cursor,
    ...(status ? { status } : {}),
  };
}

export function registerCashRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.post("/inventory/cash/:itemId/withdraw", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "cash", session.userId);
      const itemId = readItemId(request.params as { itemId?: string });
      const body = asRecord(request.body) ?? {};
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: "POST /inventory/cash/:itemId/withdraw",
          key: idempotencyKey,
          requestHash: requestHash({
            itemId,
            welvuraId: body.welvuraId,
          }),
        },
        async () => {
          const created = await withRequestCorrelation(request, () =>
            createCashItemWithdrawal(db, {
              userId: session.userId,
              itemId,
              welvuraId: body.welvuraId,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: {
              ...publicUserWithdrawal(created.withdrawal),
              replayed: created.replayed,
            },
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

  app.get("/inventory/cash-withdrawals", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "cash", session.userId);
      const listed = await listUserCashItemWithdrawals(db, {
        userId: session.userId,
        ...readListQuery(request.query as Record<string, unknown>),
      });
      return {
        items: listed.items.map(publicUserWithdrawal),
        nextCursor: listed.nextCursor,
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/cash-withdrawals", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.cashRead,
      );
      const listed = await listAdminCashItemWithdrawals(
        db,
        readListQuery(request.query as Record<string, unknown>),
      );
      return {
        items: listed.items.map(publicAdminWithdrawal),
        nextCursor: listed.nextCursor,
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/cash-withdrawals/:id/process", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.cashWrite,
      );
      const withdrawalId = readWithdrawalId(request.params as { id?: string });
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/cash-withdrawals/:id/process",
          key: idempotencyKey,
          requestHash: requestHash({ withdrawalId }),
        },
        async () => {
          const processed = await withRequestCorrelation(request, () =>
            markCashItemWithdrawalProcessing(db, {
              withdrawalId,
              adminUserId: admin.userId,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: {
              ...publicAdminWithdrawal(processed.withdrawal),
              replayed: processed.replayed,
              ...(processed.auditId ? { auditId: processed.auditId } : {}),
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/cash-withdrawals/:id/fulfill", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.cashWrite,
      );
      const withdrawalId = readWithdrawalId(request.params as { id?: string });
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/cash-withdrawals/:id/fulfill",
          key: idempotencyKey,
          requestHash: requestHash({ withdrawalId }),
        },
        async () => {
          const fulfilled = await withRequestCorrelation(request, () =>
            fulfillCashItemWithdrawal(db, {
              withdrawalId,
              adminUserId: admin.userId,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: {
              ...publicAdminWithdrawal(fulfilled.withdrawal),
              replayed: fulfilled.replayed,
              ...(fulfilled.auditId ? { auditId: fulfilled.auditId } : {}),
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/cash-withdrawals/:id/reject", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.cashWrite,
      );
      const withdrawalId = readWithdrawalId(request.params as { id?: string });
      const body = asRecord(request.body) ?? {};
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/cash-withdrawals/:id/reject",
          key: idempotencyKey,
          requestHash: requestHash({
            withdrawalId,
            reason: body.reason,
          }),
        },
        async () => {
          const rejected = await withRequestCorrelation(request, () =>
            rejectCashItemWithdrawal(db, {
              withdrawalId,
              adminUserId: admin.userId,
              reason: body.reason,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: {
              ...publicAdminWithdrawal(rejected.withdrawal),
              replayed: rejected.replayed,
              ...(rejected.auditId ? { auditId: rejected.auditId } : {}),
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
