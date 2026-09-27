import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  ForbiddenError,
  resolveMiniAppSession,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  approveWelvuraAccount,
  approveWelvuraDeposit,
  createLocalSubmissionFileStorage,
  getSubmissionFileMeta,
  listUserWelvuraAccountHistory,
  listUserWelvuraStageHistory,
  listWelvuraAccountQueue,
  listWelvuraDepositQueue,
  readWelvuraState,
  rejectWelvuraAccount,
  rejectWelvuraDeposit,
  submitWelvuraAccount,
  submitWelvuraDeposit,
  type SubmissionFileStorage,
} from "@giftbot/domain";
import { runIdempotentPost } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed, consumeIp } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import { withRequestCorrelation } from "./observability.js";

const UPLOAD_BODY_LIMIT = 12 * 1024 * 1024;

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

function correlationRequestId(request: {
  correlation?: { requestId?: string } | null;
}): string | undefined {
  return request.correlation?.requestId;
}

function readScreenshotPayload(body: unknown): {
  contentType: string;
  bytes: Buffer;
  originalFilename?: string;
  welvuraId?: string;
} {
  const record = asRecord(body);
  if (!record) {
    throw new ApiError("BAD_REQUEST", "body is required", 400);
  }
  const contentType = record.contentType;
  const screenshotBase64 = record.screenshotBase64;
  if (typeof contentType !== "string" || !contentType.startsWith("image/")) {
    throw new ApiError("WELVURA_INVALID_FILE", "contentType must be an image", 400);
  }
  if (typeof screenshotBase64 !== "string" || screenshotBase64.length === 0) {
    throw new ApiError("WELVURA_INVALID_FILE", "screenshotBase64 is required", 400);
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(screenshotBase64, "base64");
  } catch {
    throw new ApiError("WELVURA_INVALID_FILE", "invalid base64 screenshot", 400);
  }
  if (bytes.byteLength === 0) {
    throw new ApiError("WELVURA_INVALID_FILE", "empty screenshot", 400);
  }
  const originalFilename =
    typeof record.originalFilename === "string"
      ? record.originalFilename
      : undefined;
  const welvuraId =
    typeof record.welvuraId === "string" ? record.welvuraId : undefined;
  return {
    contentType,
    bytes,
    ...(originalFilename ? { originalFilename } : {}),
    ...(welvuraId ? { welvuraId } : {}),
  };
}

function readReason(body: unknown): string {
  const record = asRecord(body);
  const reason = record?.reason;
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new ApiError(
      "WELVURA_REJECTION_REASON_REQUIRED",
      "rejection reason is required",
      400,
    );
  }
  return reason.trim();
}

function readStatusFilter(query: Record<string, unknown>): string {
  const raw = query.status;
  if (typeof raw !== "string" || raw.length === 0) {
    return "pending";
  }
  return raw;
}

export function registerWelvuraRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  storage: SubmissionFileStorage,
  limiter?: RateLimiter,
): void {
  app.get("/welvura", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "welvura", session.userId);
      return readWelvuraState(db, session.userId);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/welvura/account/history", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "welvura", session.userId);
      return listUserWelvuraAccountHistory(db, session.userId);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/welvura/stages/:stage/history", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "welvura", session.userId);
      const stage = Number((request.params as { stage: string }).stage);
      if (!Number.isInteger(stage) || stage < 1 || stage > 13) {
        throw new ApiError("WELVURA_STAGE_NOT_FOUND", "welvura stage not found", 404);
      }
      return listUserWelvuraStageHistory(db, {
        userId: session.userId,
        stageNumber: stage,
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post(
    "/welvura/account/submissions",
    { bodyLimit: UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      try {
        const session = await resolveMiniAppSession(
          db,
          readBearer(request.headers.authorization),
        );
        await consumeAuthed(limiter, request, reply, "welvura", session.userId);
        const payload = readScreenshotPayload(request.body);
        if (!payload.welvuraId) {
          throw new ApiError("WELVURA_INVALID_ID", "welvuraId is required", 400);
        }
        const idempotencyKey = readIdempotencyKey(request.headers);
        const result = await runIdempotentPost(
          db,
          {
            userId: session.userId,
            route: "POST /welvura/account/submissions",
            key: idempotencyKey,
            requestHash: requestHash({
              welvuraId: payload.welvuraId,
              contentType: payload.contentType,
              byteSize: payload.bytes.byteLength,
            }),
          },
          async () => {
            const submitted = await withRequestCorrelation(request, () =>
              submitWelvuraAccount(db, storage, {
                userId: session.userId,
                welvuraId: payload.welvuraId!,
                contentType: payload.contentType,
                bytes: payload.bytes,
                ...(payload.originalFilename
                  ? { originalFilename: payload.originalFilename }
                  : {}),
              }),
            );
            return { status: 200, body: submitted };
          },
        );
        return reply.code(result.status).send(result.body);
      } catch (error) {
        return sendHttpError(reply, error);
      }
    },
  );

  app.post(
    "/welvura/stages/:stage/submissions",
    { bodyLimit: UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      try {
        const session = await resolveMiniAppSession(
          db,
          readBearer(request.headers.authorization),
        );
        await consumeAuthed(limiter, request, reply, "welvura", session.userId);
        const stage = Number((request.params as { stage: string }).stage);
        if (!Number.isInteger(stage) || stage < 1 || stage > 13) {
          throw new ApiError("WELVURA_STAGE_NOT_FOUND", "welvura stage not found", 404);
        }
        const payload = readScreenshotPayload(request.body);
        const idempotencyKey = readIdempotencyKey(request.headers);
        const result = await runIdempotentPost(
          db,
          {
            userId: session.userId,
            route: "POST /welvura/stages/:stage/submissions",
            key: idempotencyKey,
            requestHash: requestHash({
              stage,
              contentType: payload.contentType,
              byteSize: payload.bytes.byteLength,
            }),
          },
          async () => {
            const submitted = await withRequestCorrelation(request, () =>
              submitWelvuraDeposit(db, storage, {
                userId: session.userId,
                stageNumber: stage,
                contentType: payload.contentType,
                bytes: payload.bytes,
                ...(payload.originalFilename
                  ? { originalFilename: payload.originalFilename }
                  : {}),
              }),
            );
            return { status: 200, body: submitted };
          },
        );
        return reply.code(result.status).send(result.body);
      } catch (error) {
        return sendHttpError(reply, error);
      }
    },
  );

  app.get("/admin/welvura/account-submissions", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin-welvura");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.welvuraRead,
      );
      const query = request.query as Record<string, unknown>;
      return listWelvuraAccountQueue(db, {
        status: readStatusFilter(query),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/welvura/deposit-submissions", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin-welvura");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.welvuraRead,
      );
      const query = request.query as Record<string, unknown>;
      return listWelvuraDepositQueue(db, {
        status: readStatusFilter(query),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/welvura/files/:fileId", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin-welvura");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.welvuraRead,
      );
      const fileId = (request.params as { fileId: string }).fileId;
      const meta = await getSubmissionFileMeta(db, fileId);
      if (!meta) {
        throw new ApiError("NOT_FOUND", "file not found", 404);
      }
      const absolutePath = storage.resolvePath(meta.storageKey);
      await access(absolutePath);
      reply.header("content-type", meta.contentType);
      reply.header("cache-control", "private, no-store");
      return reply.send(createReadStream(absolutePath));
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/welvura/account-submissions/:id/approve", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin-welvura");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.welvuraWrite,
      );
      const id = (request.params as { id: string }).id;
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/welvura/account-submissions/:id/approve",
          key: idempotencyKey,
          requestHash: requestHash({ id }),
        },
        async () => {
          const reqId = correlationRequestId(request);
          const body = await withRequestCorrelation(request, () =>
            approveWelvuraAccount(db, {
              submissionId: id,
              adminUserId: admin.userId,
              ...(reqId ? { requestId: reqId } : {}),
            }),
          );
          return { status: 200, body };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/welvura/account-submissions/:id/reject", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin-welvura");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.welvuraWrite,
      );
      const id = (request.params as { id: string }).id;
      const reason = readReason(request.body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/welvura/account-submissions/:id/reject",
          key: idempotencyKey,
          requestHash: requestHash({ id, reason }),
        },
        async () => {
          const reqId = correlationRequestId(request);
          const body = await withRequestCorrelation(request, () =>
            rejectWelvuraAccount(db, {
              submissionId: id,
              adminUserId: admin.userId,
              reason,
              ...(reqId ? { requestId: reqId } : {}),
            }),
          );
          return { status: 200, body };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/welvura/deposit-submissions/:id/approve", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin-welvura");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.welvuraWrite,
      );
      const id = (request.params as { id: string }).id;
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/welvura/deposit-submissions/:id/approve",
          key: idempotencyKey,
          requestHash: requestHash({ id }),
        },
        async () => {
          const reqId = correlationRequestId(request);
          const body = await withRequestCorrelation(request, () =>
            approveWelvuraDeposit(db, {
              submissionId: id,
              adminUserId: admin.userId,
              ...(reqId ? { requestId: reqId } : {}),
            }),
          );
          return { status: 200, body };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/welvura/deposit-submissions/:id/reject", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin-welvura");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.welvuraWrite,
      );
      const id = (request.params as { id: string }).id;
      const reason = readReason(request.body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/welvura/deposit-submissions/:id/reject",
          key: idempotencyKey,
          requestHash: requestHash({ id, reason }),
        },
        async () => {
          const reqId = correlationRequestId(request);
          const body = await withRequestCorrelation(request, () =>
            rejectWelvuraDeposit(db, {
              submissionId: id,
              adminUserId: admin.userId,
              reason,
              ...(reqId ? { requestId: reqId } : {}),
            }),
          );
          return { status: 200, body };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}

export function createDefaultSubmissionStorage(
  rootDir = resolve(process.cwd(), ".local-uploads"),
): SubmissionFileStorage {
  return createLocalSubmissionFileStorage(rootDir);
}
