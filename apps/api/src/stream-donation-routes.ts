import {
  ADMIN_PERMISSIONS,
  authorizeAdmin,
  ForbiddenError,
  type AuthDatabase,
} from "@giftbot/auth";
import {
  attachStreamAlertConsumer,
  claimNextStreamDonation,
  completeStreamDonation,
  heartbeatStreamDonationPlaying,
  listAdminStreamDonations,
  loadStreamDonationForTts,
  STREAM_DONATION_VISIBLE_MS,
  streamDonationAudioPath,
  type StreamDonationView,
} from "@giftbot/domain";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createLogger } from "@giftbot/observability";
import type { RateLimiter } from "@giftbot/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeIp } from "./http-limit.js";
import { readBearer } from "./http-auth.js";
import { assertOverlayToken, readOverlayToken } from "./overlay-token.js";
import { subscribeStreamAlerts } from "./stream-alert-hub.js";

const logger = createLogger("api.stream-alerts");

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function publicDonation(row: StreamDonationView) {
  return {
    id: row.id,
    displayName: row.displayName,
    message: row.message,
    amountAzc: row.amountAzc,
    status: row.status,
    ttsStatus: row.ttsStatus,
    ttsDurationMs: row.ttsDurationMs,
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
  ttsDir?: string,
): void {
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

  app.post("/stream-alerts/heartbeat", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "overlay");
      overlayGuard(request, overlayToken);
      const body = asRecord(request.body) ?? {};
      const sessionId = readSessionId(body);
      const donationId = body.donationId;
      if (typeof donationId !== "string") {
        throw new ApiError("BAD_REQUEST", "donationId is required", 400);
      }
      const playing = await heartbeatStreamDonationPlaying(db, {
        sessionId,
        donationId,
      });
      return { donation: publicDonation(playing) };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.get("/stream-alerts/audio/:donationId", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "overlay");
      overlayGuard(request, overlayToken);
      const params = request.params as { donationId?: string };
      const donationId = params.donationId;
      if (!donationId) {
        throw new ApiError("BAD_REQUEST", "donationId is required", 400);
      }
      const row = await loadStreamDonationForTts(db, donationId);
      if (!row) {
        return reply.code(404).send();
      }
      if (row.ttsStatus === "pending") {
        return reply.code(202).send();
      }
      if (row.ttsStatus !== "ready" || !ttsDir || !row.ttsVoice) {
        return reply.code(204).send();
      }
      const filePath = streamDonationAudioPath(ttsDir, donationId, row.ttsVoice);
      try {
        await access(filePath);
      } catch {
        return reply.code(204).send();
      }
      reply.header("content-type", "audio/wav");
      reply.header("cache-control", "private, max-age=3600");
      return reply.send(createReadStream(filePath));
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
