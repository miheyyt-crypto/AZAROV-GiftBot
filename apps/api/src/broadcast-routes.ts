import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  ForbiddenError,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  BROADCAST_IMAGE_MAX_BYTES,
  BROADCAST_IMAGE_URL_RE,
  countBroadcastTelegramRecipients,
  createAndEnqueueTelegramBroadcast,
  createBroadcastImageStorage,
  getTelegramBroadcast,
  listTelegramBroadcasts,
  WelvuraInvalidFileError,
  type BroadcastImageStorage,
} from "@giftbot/domain";
import { runIdempotentPost } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed, consumeIp } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import { withRequestCorrelation } from "./observability.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BROADCAST_UPLOAD_BODY_LIMIT = 8 * 1024 * 1024;

const BROADCAST_MEDIA_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

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

function mediaContentType(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}

export function registerBroadcastRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
  imageStorage?: BroadcastImageStorage,
): void {
  app.get("/broadcasts/media/:file", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "broadcasts-media");
      if (!imageStorage) {
        throw new ApiError("UNAVAILABLE", "upload storage is not configured", 503);
      }
      const file = String((request.params as { file?: string }).file ?? "");
      if (!BROADCAST_MEDIA_FILE_RE.test(file)) {
        throw new ApiError("NOT_FOUND", "file not found", 404);
      }
      const imageUrl = `/broadcasts/media/${file}`;
      if (!BROADCAST_IMAGE_URL_RE.test(imageUrl)) {
        throw new ApiError("NOT_FOUND", "file not found", 404);
      }
      const absolutePath = imageStorage.resolvePathFromPublicUrl(imageUrl);
      await access(absolutePath);
      reply.header("content-type", mediaContentType(file));
      reply.header("cache-control", "private, max-age=86400");
      return reply.send(createReadStream(absolutePath));
    } catch (error) {
      if (error instanceof WelvuraInvalidFileError) {
        return sendHttpError(reply, new ApiError("NOT_FOUND", "file not found", 404));
      }
      const missing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: unknown }).code === "ENOENT";
      if (missing) {
        return sendHttpError(reply, new ApiError("NOT_FOUND", "file not found", 404));
      }
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/broadcasts/meta", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.broadcastRead,
      );
      return {
        recipientCount: await countBroadcastTelegramRecipients(db),
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/broadcasts", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.broadcastRead,
      );
      return { items: await listTelegramBroadcasts(db) };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/broadcasts/:broadcastId", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.broadcastRead,
      );
      const broadcastId = String(
        (request.params as { broadcastId?: string }).broadcastId ?? "",
      );
      if (!UUID_RE.test(broadcastId)) {
        throw new ApiError("BAD_REQUEST", "broadcast id is invalid", 400);
      }
      return await getTelegramBroadcast(db, broadcastId);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post(
    "/admin/broadcasts/media",
    { bodyLimit: BROADCAST_UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      try {
        await consumeIp(limiter, request, reply, "admin");
        await requireSuperAdmin(
          db,
          request.headers.authorization,
          ADMIN_PERMISSIONS.broadcastWrite,
        );
        if (!imageStorage) {
          throw new ApiError(
            "UNAVAILABLE",
            "upload storage is not configured",
            503,
          );
        }
        const body = asRecord(request.body) ?? {};
        const contentType =
          typeof body.contentType === "string" ? body.contentType : "";
        const imageBase64 =
          typeof body.imageBase64 === "string" ? body.imageBase64 : "";
        if (!imageBase64) {
          throw new ApiError("BAD_REQUEST", "imageBase64 is required", 400);
        }
        let bytes: Buffer;
        try {
          bytes = Buffer.from(imageBase64, "base64");
        } catch {
          throw new ApiError("BAD_REQUEST", "invalid base64 image", 400);
        }
        if (bytes.byteLength === 0) {
          throw new ApiError("BAD_REQUEST", "empty image", 400);
        }
        if (bytes.byteLength > BROADCAST_IMAGE_MAX_BYTES) {
          throw new ApiError("BAD_REQUEST", "image exceeds size limit", 400);
        }
        const stored = await imageStorage.put({ contentType, bytes });
        return { photoKey: stored.storageKey, imageUrl: stored.imageUrl };
      } catch (error) {
        if (error instanceof WelvuraInvalidFileError) {
          return sendHttpError(
            reply,
            new ApiError("BAD_REQUEST", error.message, 400),
          );
        }
        return sendHttpError(reply, error);
      }
    },
  );

  app.post("/admin/broadcasts", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.broadcastWrite,
      );
      const body = asRecord(request.body) ?? {};
      const messageText =
        typeof body.messageText === "string" ? body.messageText : "";
      const photoKey =
        typeof body.photoKey === "string" ? body.photoKey : null;
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/broadcasts",
          key: idempotencyKey,
          requestHash: requestHash({
            messageText,
            photoKey,
            button: body.button ?? null,
          }),
        },
        async () => {
          const created = await withRequestCorrelation(request, () =>
            createAndEnqueueTelegramBroadcast(db, {
              adminUserId: admin.userId,
              messageText,
              photoKey,
              button: body.button,
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
}

export function createBroadcastStorage(
  uploadDir: string | undefined,
): BroadcastImageStorage | undefined {
  return uploadDir ? createBroadcastImageStorage(uploadDir) : undefined;
}
