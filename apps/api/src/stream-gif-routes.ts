import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  ForbiddenError,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  approveStreamGif,
  createStreamGifFileStorage,
  dismissPlayingStreamGif,
  getStreamGifSubmission,
  listAdminStreamGifs,
  rejectStreamGif,
} from "@giftbot/domain";
import { runIdempotentPost } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeIp } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import {
  notifyStreamAlertsDismissed,
  notifyStreamAlertsQueued,
} from "./stream-alert-hub.js";

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

export function registerStreamGifRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter: RateLimiter | undefined,
  uploadDir: string | undefined,
): void {
  const storage = uploadDir ? createStreamGifFileStorage(uploadDir) : undefined;

  app.get("/admin/stream-gifs", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.shopRead,
      );
      return { items: await listAdminStreamGifs(db) };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/stream-gifs/:id/media", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.shopRead,
      );
      if (!storage) {
        throw new ApiError("UNAVAILABLE", "upload storage is not configured", 503);
      }
      const id = (request.params as { id?: string }).id;
      if (!id) {
        throw new ApiError("BAD_REQUEST", "id is required", 400);
      }
      const row = await getStreamGifSubmission(db, id);
      if (!row) {
        throw new ApiError("NOT_FOUND", "GIF not found", 404);
      }
      const key = row.acceptedStorageKey ?? row.stagingStorageKey;
      const absolutePath = storage.resolvePath(key);
      await access(absolutePath);
      reply.header("content-type", row.contentType);
      reply.header("cache-control", "private, no-store");
      return reply.send(createReadStream(absolutePath));
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/stream-gifs/:id/approve", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.shopWrite,
      );
      if (!storage) {
        throw new ApiError("UNAVAILABLE", "upload storage is not configured", 503);
      }
      const id = (request.params as { id?: string }).id;
      if (!id) {
        throw new ApiError("BAD_REQUEST", "id is required", 400);
      }
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/stream-gifs/:id/approve",
          key: idempotencyKey,
          requestHash: requestHash({ id }),
        },
        async () => {
          const approved = await approveStreamGif(db, storage, {
            submissionId: id,
            adminUserId: admin.userId,
            idempotencyKey,
          });
          return { status: 200, body: approved };
        },
      );
      if (!result.body.replayed && result.body.enqueued) {
        notifyStreamAlertsQueued();
      }
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/stream-gifs/:id/reject", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.shopWrite,
      );
      if (!storage) {
        throw new ApiError("UNAVAILABLE", "upload storage is not configured", 503);
      }
      const id = (request.params as { id?: string }).id;
      if (!id) {
        throw new ApiError("BAD_REQUEST", "id is required", 400);
      }
      const body = asRecord(request.body) ?? {};
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/stream-gifs/:id/reject",
          key: idempotencyKey,
          requestHash: requestHash({ id, reason: body.reason }),
        },
        async () => {
          const rejected = await rejectStreamGif(db, storage, {
            submissionId: id,
            adminUserId: admin.userId,
            reason: body.reason,
            idempotencyKey,
          });
          return { status: 200, body: rejected };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/stream-gifs/dismiss-playing", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.shopWrite,
      );
      const dismissed = await dismissPlayingStreamGif(db, {
        adminUserId: admin.userId,
      });
      notifyStreamAlertsDismissed(dismissed.donationId);
      return dismissed;
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });
}
