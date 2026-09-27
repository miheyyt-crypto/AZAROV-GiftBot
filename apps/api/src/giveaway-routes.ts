import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  ForbiddenError,
  resolveMiniAppSession,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  activateGiveaway,
  cancelGiveaway,
  clampProfileListLimit,
  createGiveaway,
  decodeProfileCursor,
  getAdminGiveawayDetail,
  getGiveawayForUser,
  GIVEAWAY_IMAGE_MAX_BYTES,
  GIVEAWAY_IMAGE_URL_RE,
  joinGiveaway,
  listAdminGiveaways,
  listGiveawaysForUser,
  markCustomPrizeDelivered,
  updateDraftGiveaway,
  WelvuraInvalidFileError,
  type GiveawayDbStatus,
  type GiveawayImageStorage,
  type GiveawayType,
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

const GIVEAWAY_UPLOAD_BODY_LIMIT = 6 * 1024 * 1024;

const GIVEAWAY_MEDIA_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

const DB_STATUSES = new Set<GiveawayDbStatus | "all">([
  "all",
  "draft",
  "open",
  "closed",
  "settled",
  "cancelled",
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

function rejectInjectedResult(body: Record<string, unknown>): void {
  const forbidden = [
    "winners",
    "winnerIds",
    "payout",
    "payoutAzc",
    "actualWinnerCount",
    "forceWinner",
    "forceWinners",
    "result",
    "seed",
    "rng",
    "drawnAt",
    "completedAt",
    "status",
    "prizeAzc",
    "reward",
    "rewardAzc",
  ];
  for (const key of forbidden) {
    if (key in body) {
      throw new ApiError("BAD_REQUEST", "client result fields are not allowed", 400);
    }
  }
}

function readReason(body: Record<string, unknown>): string {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    throw new ApiError("BAD_REQUEST", "reason is required", 400);
  }
  return reason;
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

function readGiveawayId(params: { id?: string }): string {
  const id = params.id ?? "";
  if (!UUID_RE.test(id)) {
    throw new ApiError("BAD_REQUEST", "giveaway id is invalid", 400);
  }
  return id;
}

function readWinnerId(params: { winnerId?: string }): string {
  const winnerId = params.winnerId ?? "";
  if (!UUID_RE.test(winnerId)) {
    throw new ApiError("BAD_REQUEST", "winner id is invalid", 400);
  }
  return winnerId;
}

function readTab(query: Record<string, unknown>): "active" | "completed" {
  const tab = query.tab;
  if (tab === undefined || tab === null || tab === "") {
    return "active";
  }
  if (tab === "active" || tab === "completed") {
    return tab;
  }
  throw new ApiError("BAD_REQUEST", "tab must be active|completed", 400);
}

function readAdminListQuery(query: Record<string, unknown>) {
  const rawLimit = query.limit;
  const limit =
    typeof rawLimit === "string" || typeof rawLimit === "number"
      ? clampProfileListLimit(
          typeof rawLimit === "number" ? rawLimit : Number(rawLimit),
        )
      : clampProfileListLimit(undefined);
  const rawStatus = query.status;
  let status: GiveawayDbStatus | "all" | undefined;
  if (typeof rawStatus === "string" && rawStatus.length > 0) {
    if (!DB_STATUSES.has(rawStatus as GiveawayDbStatus | "all")) {
      throw new ApiError("BAD_REQUEST", "status is invalid", 400);
    }
    status = rawStatus as GiveawayDbStatus | "all";
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

function readDetailQuery(query: Record<string, unknown>) {
  const rawLimit = query.participantsLimit ?? query.limit;
  const participantsLimit =
    typeof rawLimit === "string" || typeof rawLimit === "number"
      ? clampProfileListLimit(
          typeof rawLimit === "number" ? rawLimit : Number(rawLimit),
        )
      : undefined;
  const rawCursor = query.participantsCursor ?? query.cursor;
  if (typeof rawCursor !== "string" || rawCursor.length === 0) {
    return participantsLimit !== undefined ? { participantsLimit } : {};
  }
  const participantsCursor = decodeProfileCursor(rawCursor);
  if (!participantsCursor) {
    throw new ApiError("BAD_REQUEST", "cursor is invalid", 400);
  }
  return {
    ...(participantsLimit !== undefined ? { participantsLimit } : {}),
    participantsCursor,
  };
}

function readOptionalImageUrl(
  body: Record<string, unknown>,
): string | null | undefined {
  if (!("imageUrl" in body)) {
    return undefined;
  }
  if (body.imageUrl === null || body.imageUrl === "") {
    return null;
  }
  if (typeof body.imageUrl !== "string") {
    throw new ApiError("BAD_REQUEST", "invalid imageUrl", 400);
  }
  if (!GIVEAWAY_IMAGE_URL_RE.test(body.imageUrl)) {
    throw new ApiError("BAD_REQUEST", "invalid imageUrl", 400);
  }
  return body.imageUrl;
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

export function registerGiveawayRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
  imageStorage?: GiveawayImageStorage,
): void {
  app.get("/giveaways/media/:file", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "giveaways-media");
      if (!imageStorage) {
        throw new ApiError("UNAVAILABLE", "upload storage is not configured", 503);
      }
      const file = String((request.params as { file?: string }).file ?? "");
      if (!GIVEAWAY_MEDIA_FILE_RE.test(file)) {
        throw new ApiError("NOT_FOUND", "file not found", 404);
      }
      const imageUrl = `/giveaways/media/${file}`;
      const absolutePath = imageStorage.resolvePathFromPublicUrl(imageUrl);
      await access(absolutePath);
      reply.header("content-type", mediaContentType(file));
      reply.header("cache-control", "public, max-age=86400, immutable");
      return reply.send(createReadStream(absolutePath));
    } catch (error) {
      if (error instanceof WelvuraInvalidFileError) {
        return sendHttpError(
          reply,
          new ApiError("NOT_FOUND", "file not found", 404),
        );
      }
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: unknown }).code === "ENOENT";
      if (code) {
        return sendHttpError(
          reply,
          new ApiError("NOT_FOUND", "file not found", 404),
        );
      }
      return sendHttpError(reply, error);
    }
  });

  app.post(
    "/admin/giveaways/media",
    { bodyLimit: GIVEAWAY_UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      try {
        await consumeIp(limiter, request, reply, "admin");
        await requireSuperAdmin(
          db,
          request.headers.authorization,
          ADMIN_PERMISSIONS.giveawayWrite,
        );
        if (!imageStorage) {
          throw new ApiError(
            "UNAVAILABLE",
            "upload storage is not configured",
            503,
          );
        }
        const body = asRecord(request.body) ?? {};
        rejectInjectedResult(body);
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
        if (bytes.byteLength > GIVEAWAY_IMAGE_MAX_BYTES) {
          throw new ApiError("BAD_REQUEST", "image exceeds size limit", 400);
        }
        const stored = await imageStorage.put({ contentType, bytes });
        return { imageUrl: stored.imageUrl };
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

  app.get("/giveaways", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "giveaways", session.userId);
      const tab = readTab(request.query as Record<string, unknown>);
      return listGiveawaysForUser(db, { userId: session.userId, tab });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/giveaways/:id", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "giveaways", session.userId);
      const giveawayId = readGiveawayId(request.params as { id?: string });
      return getGiveawayForUser(db, {
        giveawayId,
        userId: session.userId,
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/giveaways/:id/join", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "giveaways", session.userId);
      const giveawayId = readGiveawayId(request.params as { id?: string });
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: "POST /giveaways/:id/join",
          key: idempotencyKey,
          requestHash: requestHash({ giveawayId }),
        },
        async () => {
          const joined = await withRequestCorrelation(request, () =>
            joinGiveaway(db, {
              giveawayId,
              userId: session.userId,
            }),
          );
          return {
            status: 200,
            body: {
              id: joined.id,
              replayed: joined.replayed,
            },
          };
        },
      );
      return reply.code(result.status).send({
        ...result.body,
        replayed: result.replayed || Boolean(result.body.replayed),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/giveaways", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.giveawayRead,
      );
      const listed = await listAdminGiveaways(
        db,
        readAdminListQuery(request.query as Record<string, unknown>),
      );
      return listed;
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/giveaways/:id", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.giveawayRead,
      );
      const giveawayId = readGiveawayId(request.params as { id?: string });
      return getAdminGiveawayDetail(db, {
        giveawayId,
        ...readDetailQuery(request.query as Record<string, unknown>),
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/giveaways", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.giveawayWrite,
      );
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const reason = readReason(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/giveaways",
          key: idempotencyKey,
          requestHash: requestHash({
            title: body.title,
            type: body.type,
            bankAzc: body.bankAzc,
            customPrize: body.customPrize,
            winnerCount: body.winnerCount,
            endsAt: body.endsAt,
            eligibility: body.eligibility,
            imageUrl: body.imageUrl ?? null,
            reason,
          }),
        },
        async () => {
          const imageUrl = readOptionalImageUrl(body);
          const created = await withRequestCorrelation(request, () =>
            createGiveaway(db, {
              title: body.title as string,
              type: body.type as GiveawayType,
              winnerCount: body.winnerCount as number,
              adminUserId: admin.userId,
              reason,
              ...(body.bankAzc !== undefined
                ? { bankAzc: body.bankAzc as string | number | null }
                : {}),
              ...(body.customPrize !== undefined
                ? { customPrize: body.customPrize as string | null }
                : {}),
              ...(body.endsAt !== undefined
                ? { endsAt: body.endsAt as string | null }
                : {}),
              ...(body.eligibility !== undefined
                ? { eligibility: body.eligibility as "linked_kick" }
                : {}),
              ...(imageUrl !== undefined ? { imageUrl } : {}),
            }),
          );
          return {
            status: 200,
            body: {
              ...created.giveaway,
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

  app.patch("/admin/giveaways/:id", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.giveawayWrite,
      );
      const giveawayId = readGiveawayId(request.params as { id?: string });
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const reason = readReason(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "PATCH /admin/giveaways/:id",
          key: idempotencyKey,
          requestHash: requestHash({
            giveawayId,
            title: body.title,
            type: body.type,
            bankAzc: body.bankAzc,
            customPrize: body.customPrize,
            winnerCount: body.winnerCount,
            endsAt: body.endsAt,
            imageUrl: body.imageUrl ?? null,
            reason,
          }),
        },
        async () => {
          const imageUrl = readOptionalImageUrl(body);
          const updated = await withRequestCorrelation(request, () =>
            updateDraftGiveaway(db, {
              giveawayId,
              ...(body.title !== undefined
                ? { title: body.title as string }
                : {}),
              ...(body.type !== undefined
                ? { type: body.type as GiveawayType }
                : {}),
              ...(body.bankAzc !== undefined
                ? { bankAzc: body.bankAzc as string | number | null }
                : {}),
              ...(body.customPrize !== undefined
                ? { customPrize: body.customPrize as string | null }
                : {}),
              ...(body.winnerCount !== undefined
                ? { winnerCount: body.winnerCount as number }
                : {}),
              ...(body.endsAt !== undefined
                ? { endsAt: body.endsAt as string | null }
                : {}),
              ...(imageUrl !== undefined ? { imageUrl } : {}),
              adminUserId: admin.userId,
              reason,
            }),
          );
          return {
            status: 200,
            body: {
              ...updated.giveaway,
              auditId: updated.auditId,
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/giveaways/:id/activate", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.giveawayWrite,
      );
      const giveawayId = readGiveawayId(request.params as { id?: string });
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const reason = readReason(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/giveaways/:id/activate",
          key: idempotencyKey,
          requestHash: requestHash({ giveawayId, reason }),
        },
        async () => {
          const activated = await withRequestCorrelation(request, () =>
            activateGiveaway(db, {
              giveawayId,
              adminUserId: admin.userId,
              reason,
            }),
          );
          return {
            status: 200,
            body: {
              ...activated.giveaway,
              ...(activated.auditId ? { auditId: activated.auditId } : {}),
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/giveaways/:id/cancel", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.giveawayWrite,
      );
      const giveawayId = readGiveawayId(request.params as { id?: string });
      const body = asRecord(request.body) ?? {};
      rejectInjectedResult(body);
      const reason = readReason(body);
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/giveaways/:id/cancel",
          key: idempotencyKey,
          requestHash: requestHash({ giveawayId, reason }),
        },
        async () => {
          const cancelled = await withRequestCorrelation(request, () =>
            cancelGiveaway(db, {
              giveawayId,
              adminUserId: admin.userId,
              reason,
            }),
          );
          return {
            status: 200,
            body: {
              ...cancelled.giveaway,
              ...(cancelled.auditId ? { auditId: cancelled.auditId } : {}),
            },
          };
        },
      );
      return reply.code(result.status).send(result.body);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post(
    "/admin/giveaways/:id/winners/:winnerId/deliver",
    async (request, reply) => {
      try {
        await consumeIp(limiter, request, reply, "admin");
        const admin = await requireSuperAdmin(
          db,
          request.headers.authorization,
          ADMIN_PERMISSIONS.giveawayWrite,
        );
        const giveawayId = readGiveawayId(request.params as { id?: string });
        const winnerId = readWinnerId(
          request.params as { winnerId?: string },
        );
        const body = asRecord(request.body) ?? {};
        rejectInjectedResult(body);
        const reason = readReason(body);
        const idempotencyKey = readIdempotencyKey(request.headers);
        const result = await runIdempotentPost(
          db,
          {
            userId: admin.userId,
            route: "POST /admin/giveaways/:id/winners/:winnerId/deliver",
            key: idempotencyKey,
            requestHash: requestHash({ giveawayId, winnerId, reason }),
          },
          async () => {
            const delivered = await withRequestCorrelation(request, () =>
              markCustomPrizeDelivered(db, {
                giveawayId,
                winnerUserId: winnerId,
                adminUserId: admin.userId,
                reason,
              }),
            );
            return {
              status: 200,
              body: {
                winnerId: delivered.winnerId,
                replayed: delivered.replayed,
                ...(delivered.auditId ? { auditId: delivered.auditId } : {}),
              },
            };
          },
        );
        return reply.code(result.status).send({
          ...result.body,
          replayed: result.replayed || Boolean(result.body.replayed),
        });
      } catch (error) {
        return sendHttpError(reply, error);
      }
    },
  );
}
