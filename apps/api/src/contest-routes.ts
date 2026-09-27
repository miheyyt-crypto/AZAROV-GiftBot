import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  ForbiddenError,
  resolveMiniAppSession,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  createReferralContest,
  finalizeReferralContest,
  getAdminReferralContest,
  listAdminReferralContests,
  readReferralContestHomeSummary,
  readReferralContestPage,
  readReferralMe,
} from "@giftbot/domain";
import { runIdempotentPost } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
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

export function registerContestRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
  options: { botUsername?: string } = {},
): void {
  const botUsername = options.botUsername ?? "giftbot";

  app.get("/contest/referral/summary", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "contest-summary", session.userId);
      const contest = await readReferralContestHomeSummary(db);
      return { contest };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/contest/referral", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "contest", session.userId);
      const me = await readReferralMe(db, {
        userId: session.userId,
        botUsername,
      });
      return await readReferralContestPage(db, {
        userId: session.userId,
        referralUrl: me.referralUrl,
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/contest/referral", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.contestRead,
      );
      return await listAdminReferralContests(db);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/contest/referral/:contestId", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.contestRead,
      );
      const contestId = String(
        (request.params as { contestId?: string }).contestId ?? "",
      );
      if (!UUID_RE.test(contestId)) {
        throw new ApiError("NOT_FOUND", "contest not found", 404);
      }
      return await getAdminReferralContest(db, contestId);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/contest/referral", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.contestWrite,
      );
      const body = asRecord(request.body) ?? {};
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/contest/referral",
          key: idempotencyKey,
          requestHash: requestHash(body),
        },
        async () => {
          const created = await withRequestCorrelation(request, () =>
            createReferralContest(db, {
              adminUserId: admin.userId,
              prizes: body.prizes,
              startNow: body.startNow === true,
              ...(typeof body.startAt === "string" ? { startAt: body.startAt } : {}),
              ...(typeof body.title === "string" ? { title: body.title } : {}),
              reason: "admin create referral contest",
            }),
          );
          return { status: 200, body: created };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/contest/referral/:contestId/finalize", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.contestWrite,
      );
      const contestId = String(
        (request.params as { contestId?: string }).contestId ?? "",
      );
      if (!UUID_RE.test(contestId)) {
        throw new ApiError("NOT_FOUND", "contest not found", 404);
      }
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/contest/referral/:contestId/finalize",
          key: idempotencyKey,
          requestHash: requestHash({ contestId }),
        },
        async () => {
          const finalized = await withRequestCorrelation(request, () =>
            finalizeReferralContest(db, contestId, {
              closeWindow: true,
              adminUserId: admin.userId,
            }),
          );
          return { status: 200, body: finalized };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
