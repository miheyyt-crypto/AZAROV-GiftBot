import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  ForbiddenError,
  resolveMiniAppSession,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  attachStreamAlertConsumer,
  claimNextStreamDonation,
  completeStreamDonation,
  createStreamDonation,
  listAdminStreamDonations,
  listMyStreamDonations,
  STREAM_DONATION_MESSAGE_MAX,
  STREAM_DONATION_PRICE_AZC,
  STREAM_DONATION_VISIBLE_MS,
  type StreamDonationView,
} from "@giftbot/domain";
import { runIdempotentPost } from "@giftbot/jobs";
import { createLogger } from "@giftbot/observability";
import type { RateLimiter } from "@giftbot/rate-limit";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeAuthed, consumeIp } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import { withRequestCorrelation } from "./observability.js";
import { assertOverlayToken, readOverlayToken } from "./overlay-token.js";
import { notifyStreamAlertsQueued, subscribeStreamAlerts } from "./stream-alert-hub.js";

const logger = createLogger("api.stream-alerts");

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

function publicDonation(row: StreamDonationView) {
  return {
    id: row.id,
    displayName: row.displayName,
    message: row.message,
    amountAzc: row.amountAzc,
    status: row.status,
    createdAt: row.createdAt,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function readSessionId(body: Record<string, unknown>): string {
  const raw = body.sessionId;
  if (typeof raw !== "string") {
    throw new ApiError("BAD_REQUEST", "sessionId is required", 400);
  }
  return raw;
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

function overlayGuard(
  request: FastifyRequest,
  overlayToken: string | undefined,
): void {
  const query = request.query as Record<string, unknown>;
  assertOverlayToken(readOverlayToken(query, request.headers), overlayToken);
}

export function registerStreamDonationRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  limiter: RateLimiter | undefined,
  overlayToken: string | undefined,
): void {
  app.get("/stream-donations/quote", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "stream-donations", session.userId);
      return {
        priceAzc: STREAM_DONATION_PRICE_AZC.toString(),
        messageMax: STREAM_DONATION_MESSAGE_MAX,
        visibleMs: STREAM_DONATION_VISIBLE_MS,
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/stream-donations/me", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "stream-donations", session.userId);
      const items = await listMyStreamDonations(db, session.userId);
      return { items: items.map(publicDonation) };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/stream-donations", async (request, reply) => {
    try {
      const session = await resolveMiniAppSession(
        db,
        readBearer(request.headers.authorization),
      );
      await consumeAuthed(limiter, request, reply, "stream-donations", session.userId);
      const body = asRecord(request.body) ?? {};
      const idempotencyKey = readIdempotencyKey(request.headers);
      if (
        body.clientRequestId !== undefined &&
        body.clientRequestId !== null &&
        String(body.clientRequestId) !== idempotencyKey
      ) {
        throw new ApiError("BAD_REQUEST", "clientRequestId mismatch", 400);
      }
      const result = await runIdempotentPost(
        db,
        {
          userId: session.userId,
          route: "POST /stream-donations",
          key: idempotencyKey,
          requestHash: requestHash({ message: body.message }),
        },
        async () => {
          const created = await withRequestCorrelation(request, () =>
            createStreamDonation(db, {
              userId: session.userId,
              message: body.message,
              clientRequestId: idempotencyKey,
              submittedUserId: body.userId,
              submittedDisplayName: body.displayName ?? body.username,
            }),
          );
          return {
            status: 200,
            body: {
              ...publicDonation(created),
              newBalanceAzc: created.newBalanceAzc,
              replayed: created.replayed,
            },
          };
        },
      );
      const payload = {
        ...result.body,
        replayed: result.replayed || Boolean(result.body.replayed),
      };
      if (!payload.replayed) {
        logger.info("donation_created", { donation_id: payload.id });
        notifyStreamAlertsQueued();
      }
      return reply.code(result.status).send(payload);
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/admin/stream-donations", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "admin");
      await requireSuperAdmin(
        db,
        request.headers.authorization,
        ADMIN_PERMISSIONS.walletRead,
      );
      const items = await listAdminStreamDonations(db);
      return { items: items.map(publicDonation) };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/stream-alerts/attach", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "overlay");
      overlayGuard(request, overlayToken);
      const sessionId = readSessionId(asRecord(request.body) ?? {});
      const attached = await attachStreamAlertConsumer(db, { sessionId });
      if (attached.recovered > 0) {
        logger.info("donation_recovered", { recovered: attached.recovered });
      }
      return { sessionId: attached.sessionId, recovered: attached.recovered };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/stream-alerts/claim", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "overlay");
      overlayGuard(request, overlayToken);
      const sessionId = readSessionId(asRecord(request.body) ?? {});
      const claimed = await claimNextStreamDonation(db, { sessionId });
      if (claimed.recovered > 0) {
        logger.info("donation_recovered", { recovered: claimed.recovered });
      }
      if (claimed.donation) {
        logger.info("donation_claimed", { donation_id: claimed.donation.id });
      }
      return {
        donation: claimed.donation ? publicDonation(claimed.donation) : null,
        recovered: claimed.recovered,
        visibleMs: STREAM_DONATION_VISIBLE_MS,
      };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post("/stream-alerts/complete", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "overlay");
      overlayGuard(request, overlayToken);
      const body = asRecord(request.body) ?? {};
      const sessionId = readSessionId(body);
      const donationId = body.donationId;
      if (typeof donationId !== "string") {
        throw new ApiError("BAD_REQUEST", "donationId is required", 400);
      }
      const finished = await completeStreamDonation(db, {
        sessionId,
        donationId,
      });
      logger.info("donation_finished", { donation_id: finished.id });
      return { donation: publicDonation(finished) };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/stream-alerts/events", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "overlay");
      overlayGuard(request, overlayToken);
    } catch (error) {
      return sendHttpError(reply, error);
    }

    logger.info("overlay_connected", {});
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write("retry: 2000\n\n");
    reply.raw.write("event: ready\ndata: {}\n\n");
    const send = (): void => {
      reply.raw.write("event: queued\ndata: {}\n\n");
    };
    const unsubscribe = subscribeStreamAlerts(send);
    const ping = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15_000);
    const onClose = (): void => {
      clearInterval(ping);
      unsubscribe();
      request.raw.off("close", onClose);
      logger.info("overlay_disconnected", {});
    };
    request.raw.on("close", onClose);
  });
}
