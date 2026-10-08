import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  ForbiddenError,
  resolveMiniAppSession,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  clampProfileListLimit,
  createShopOrder,
  decodeProfileCursor,
  fulfillShopOrder,
  listAdminShopOrders,
  listShopCatalog,
  markShopOrderProcessing,
  rejectShopOrder,
  STREAM_ALERT_SHOP_PRODUCT_CODE,
  STREAM_GIF_UPLOAD_BODY_MAX,
  createStreamGifFileStorage,
  getOwnedStreamGifUpload,
  stageStreamGifUpload,
  type ShopOrderRecord,
  type ShopOrderStatus,
} from "@giftbot/domain";
import { enqueueJob, JOB_TYPES, runIdempotentPost } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed, consumeIp } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import { withRequestCorrelation } from "./observability.js";
import { notifyStreamAlertsQueued } from "./stream-alert-hub.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATUSES = new Set<ShopOrderStatus | "all">([
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

function publicUserOrder(row: {
  status: string;
  orderId: string;
  productCode: string;
  priceAzc: string;
  newBalanceAzc: string;
  replayed: boolean;
  inventoryGranted?: { type: "streak_freeze"; quantity: 1 };
}) {
  return {
    status: row.status,
    orderId: row.orderId,
    productCode: row.productCode,
    priceAzc: row.priceAzc,
    newBalanceAzc: row.newBalanceAzc,
    replayed: row.replayed,
    ...(row.inventoryGranted ? { inventoryGranted: row.inventoryGranted } : {}),
  };
}

function publicAdminOrder(row: ShopOrderRecord) {
  return {
    id: row.id,
    user: row.publicId,
    productCode: row.productCode,
    productName: row.productName,
    priceAzc: row.priceAzc,
    status: row.status,
    submittedPayload: row.submittedPayload,
    createdAt: row.createdAt,
    processingAt: row.processingAt,
    fulfilledAt: row.fulfilledAt,
    rejectedAt: row.rejectedAt,
    rejectionReason: row.rejectionReason,
    processedByAdminId: row.processedByAdminId,
    fulfillmentType: row.fulfillmentType,
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

function readOrderId(params: { id?: string }): string {
  const id = params.id ?? "";
  if (!UUID_RE.test(id)) {
    throw new ApiError("BAD_REQUEST", "order id is invalid", 400);
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
  let status: ShopOrderStatus | "all" | undefined;
  if (typeof rawStatus === "string" && rawStatus.length > 0) {
    if (!STATUSES.has(rawStatus as ShopOrderStatus | "all")) {
      throw new ApiError("BAD_REQUEST", "status is invalid", 400);
    }
    status = rawStatus as ShopOrderStatus | "all";
  }
  const rawCode = query.productCode;
  const productCode =
    typeof rawCode === "string" && rawCode.length > 0 ? rawCode : undefined;
  const rawCursor = query.cursor;
  if (typeof rawCursor !== "string" || rawCursor.length === 0) {
    return {
      limit,
      ...(status ? { status } : {}),
      ...(productCode ? { productCode } : {}),
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
    ...(productCode ? { productCode } : {}),
  };
}

const GIF_UPLOAD_BODY_LIMIT = STREAM_GIF_UPLOAD_BODY_MAX;

export function registerShopRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter?: RateLimiter,
  uploadDir?: string,
): void {
  app.get("/shop/catalog", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "shop", session.userId);
      return { items: await listShopCatalog(db) };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post(
    "/shop/gif-uploads",
    { bodyLimit: GIF_UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      try {
        const session = await resolveMiniAppSession(
          db,
          readBearer(request.headers.authorization),
        );
        await consumeAuthed(limiter, request, reply, "shop", session.userId);
        if (!uploadDir) {
          throw new ApiError("UNAVAILABLE", "upload storage is not configured", 503);
        }
        let bytes: Buffer;
        let declaredType: string | undefined;
        if (Buffer.isBuffer(request.body)) {
          bytes = request.body;
          const headerType = request.headers["x-content-type"];
          declaredType = Array.isArray(headerType) ? headerType[0] : headerType;
        } else {
          const body = asRecord(request.body) ?? {};
          const gifBase64 = body.gifBase64;
          if (typeof gifBase64 !== "string" || gifBase64.length === 0) {
            throw new ApiError(
              "STREAM_MEDIA_UNSUPPORTED_FORMAT",
              "Загрузите JPG, PNG, WebP, GIF, MP4, MOV или WebM",
              400,
            );
          }
          try {
            bytes = Buffer.from(gifBase64, "base64");
          } catch {
            throw new ApiError("STREAM_MEDIA_CORRUPT", "Не удалось прочитать файл", 400);
          }
          if (typeof body.contentType === "string") {
            declaredType = body.contentType;
          }
        }
        const staged = await stageStreamGifUpload(
          db,
          createStreamGifFileStorage(uploadDir),
          {
            userId: session.userId,
            bytes,
            ...(declaredType ? { contentType: declaredType } : {}),
          },
        );
        if (staged.needsPrepare) {
          await enqueueJob(db, {
            type: JOB_TYPES.streamMediaPrepare,
            idempotencyKey: `stream_media.prepare:${staged.uploadId}`,
            payload: { submission_id: staged.uploadId },
          });
        }
        return staged;
      } catch (error) {
        return sendHttpError(reply, error);
      }
    },
  );

  app.get("/shop/gif-uploads/:uploadId", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "shop", session.userId);
      const params = request.params as { uploadId?: string };
      return await getOwnedStreamGifUpload(db, {
        userId: session.userId,
        uploadId: params.uploadId ?? "",
      });
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/shop/orders", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "shop", session.userId);
      const body = asRecord(request.body) ?? {};
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: "POST /shop/orders",
          key: idempotencyKey,
          requestHash: requestHash({
            productCode: body.productCode,
            submittedData: body.submittedData,
          }),
        },
        async () => {
          const created = await withRequestCorrelation(request, () =>
            createShopOrder(db, {
              userId: session.userId,
              productCode: body.productCode,
              submittedData: body.submittedData,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: publicUserOrder(created),
          };
        },
      );
      // HTTP-layer replay must surface replayed=true even though the cached
      // body was stored from the first create (replayed=false).
      const payload = {
        ...result.body,
        replayed: result.replayed,
      };
      if (
        !payload.replayed &&
        payload.productCode === STREAM_ALERT_SHOP_PRODUCT_CODE
      ) {
        notifyStreamAlertsQueued();
      }
      return reply.code(result.status).send(payload);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/shop/orders", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.shopRead,
      );
      const listed = await listAdminShopOrders(
        db,
        readListQuery(request.query as Record<string, unknown>),
      );
      return {
        items: listed.items.map(publicAdminOrder),
        nextCursor: listed.nextCursor,
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/admin/shop/orders/:id/process", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.shopWrite,
      );
      const orderId = readOrderId(request.params as { id?: string });
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/shop/orders/:id/process",
          key: idempotencyKey,
          requestHash: requestHash({ orderId }),
        },
        async () => {
          const processed = await withRequestCorrelation(request, () =>
            markShopOrderProcessing(db, {
              orderId,
              adminUserId: admin.userId,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: {
              ...publicAdminOrder(processed.order),
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

  app.post("/admin/shop/orders/:id/fulfill", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.shopWrite,
      );
      const orderId = readOrderId(request.params as { id?: string });
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/shop/orders/:id/fulfill",
          key: idempotencyKey,
          requestHash: requestHash({ orderId }),
        },
        async () => {
          const fulfilled = await withRequestCorrelation(request, () =>
            fulfillShopOrder(db, {
              orderId,
              adminUserId: admin.userId,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: {
              ...publicAdminOrder(fulfilled.order),
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

  app.post("/admin/shop/orders/:id/reject", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      const admin = await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.shopWrite,
      );
      const orderId = readOrderId(request.params as { id?: string });
      const body = asRecord(request.body) ?? {};
      const idempotencyKey = readIdempotencyKey(request.headers);
      const result = await runIdempotentPost(
        db,
        {
          userId: admin.userId,
          route: "POST /admin/shop/orders/:id/reject",
          key: idempotencyKey,
          requestHash: requestHash({ orderId, reason: body.reason }),
        },
        async () => {
          const rejected = await withRequestCorrelation(request, () =>
            rejectShopOrder(db, {
              orderId,
              adminUserId: admin.userId,
              reason: body.reason,
              idempotencyKey,
            }),
          );
          return {
            status: 200,
            body: {
              ...publicAdminOrder(rejected.order),
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
