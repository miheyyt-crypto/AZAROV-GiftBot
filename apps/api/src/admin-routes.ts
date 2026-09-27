import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  adjustWallet,
  readAdminLedgerView,
  readAdminUserView,
  readAdminWalletView,
} from "@giftbot/domain";
import { runIdempotentPost } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeIp } from "./http-limit.js";
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

function readUserId(params: { userId?: string }): string {
  const userId = params.userId ?? "";
  if (!UUID_RE.test(userId)) {
    throw new ApiError("BAD_REQUEST", "user id is invalid", 400);
  }
  return userId;
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

function readAdjustBody(body: unknown): { amountMinor: bigint; reason: string } {
  const row = asRecord(body) ?? {};
  const reason = typeof row.reason === "string" ? row.reason.trim() : "";
  if (!reason) {
    throw new ApiError("BAD_REQUEST", "reason is required", 400);
  }
  const raw = row.amountMinor;
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new ApiError("BAD_REQUEST", "amountMinor is required", 400);
  }
  try {
    const amountMinor = BigInt(raw);
    if (amountMinor === 0n) {
      throw new Error("zero");
    }
    return { amountMinor, reason };
  } catch {
    throw new ApiError("BAD_REQUEST", "amountMinor is invalid", 400);
  }
}

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
}


export function registerAdminRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
): void {
  app.get("/admin/me", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await authorizeAdmin(
        db,
        readBearer(request.headers.authorization),
        ADMIN_PERMISSIONS.usersRead,
      );
      return {
        userId: admin.userId,
        roles: admin.roles,
        session: { expiresAt: admin.expiresAt.toISOString() },
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/users/:userId", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await authorizeAdmin(
        db,
        readBearer(request.headers.authorization),
        ADMIN_PERMISSIONS.usersRead,
      );
      return await readAdminUserView(
        db,
        readUserId(request.params as { userId?: string }),
      );
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/users/:userId/wallet", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await authorizeAdmin(
        db,
        readBearer(request.headers.authorization),
        ADMIN_PERMISSIONS.walletRead,
      );
      return await readAdminWalletView(
        db,
        readUserId(request.params as { userId?: string }),
      );
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/users/:userId/ledger", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await authorizeAdmin(
        db,
        readBearer(request.headers.authorization),
        ADMIN_PERMISSIONS.walletRead,
      );
      return await readAdminLedgerView(
        db,
        readUserId(request.params as { userId?: string }),
      );
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/users/:userId/wallet/adjust", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await authorizeAdmin(
        db,
        readBearer(request.headers.authorization),
        ADMIN_PERMISSIONS.walletAdjust,
      );
      const userId = readUserId(request.params as { userId?: string });
      const body = readAdjustBody(request.body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/users/:userId/wallet/adjust",
          key: idempotencyKey,
          requestHash: requestHash({
            userId,
            amountMinor: body.amountMinor.toString(),
            reason: body.reason,
          }),
        },
        async () => {
          const adjusted = await withRequestCorrelation(request, () =>
            adjustWallet(db, {
              targetUserId: userId,
              amountMinor: body.amountMinor,
              reason: body.reason,
              idempotencyKey,
              adminUserId: admin.userId,
            }),
          );
          return {
            status: 200,
            body: {
              userId,
              replayed: adjusted.replayed,
              balanceMinor: adjusted.applied.wallet.balanceMinor.toString(),
              transactionId: adjusted.applied.transaction.id,
              ...(adjusted.auditId ? { auditId: adjusted.auditId } : {}),
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
