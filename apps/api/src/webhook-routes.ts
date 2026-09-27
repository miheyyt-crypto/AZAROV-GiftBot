import {
  createKickPublicKeyResolver,
  verifyKickEventSignature,
  verifyTelegramWebhookSecret,
  type AuthDatabase,
} from "@giftbot/auth";
import { persistInboundAndEnqueue } from "@giftbot/jobs";
import type { RateLimiter } from "@giftbot/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { ApiError, sendHttpError } from "./errors.js";
import { consumeIp } from "./http-limit.js";

export type WebhookSecrets = {
  telegramSecret?: string;
  kickPublicKeyPem?: string;
  fetchKickPublicKey?: typeof fetch;
};

const TELEGRAM_UPDATE_TYPES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "inline_query",
  "chosen_inline_result",
  "callback_query",
  "shipping_query",
  "pre_checkout_query",
  "poll",
  "poll_answer",
  "my_chat_member",
  "chat_member",
  "chat_join_request",
] as const;

const kickRawBodies = new WeakMap<FastifyRequest, Buffer>();

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function telegramEventType(body: Record<string, unknown>): string {
  for (const key of TELEGRAM_UPDATE_TYPES) {
    if (key in body) {
      return key;
    }
  }
  return "update";
}

function readTelegramUpdate(body: unknown): {
  externalEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
} {
  if (typeof body !== "object" || body === null || !("update_id" in body)) {
    throw new ApiError("BAD_REQUEST", "telegram update_id is required", 400);
  }
  const updateId = body.update_id;
  if (
    typeof updateId !== "number" &&
    !(typeof updateId === "string" && /^\d+$/.test(updateId))
  ) {
    throw new ApiError("BAD_REQUEST", "telegram update_id is required", 400);
  }
  return {
    externalEventId: String(updateId),
    eventType: telegramEventType(body as Record<string, unknown>),
    payload: body as Record<string, unknown>,
  };
}

function readKickEvent(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): {
  externalEventId: string;
  eventType: string;
  payload: unknown;
} {
  const headerId = headerValue(headers["kick-event-message-id"]);
  if (!headerId) {
    throw new ApiError("BAD_REQUEST", "kick event id is required", 400);
  }
  const eventType = headerValue(headers["kick-event-type"]) ?? "event";
  return {
    externalEventId: headerId,
    eventType,
    payload: body,
  };
}


export function registerWebhookRoutes(
  app: FastifyInstance,
  db: AuthDatabase,
  secrets: WebhookSecrets,
  limiter?: RateLimiter,
): void {
  const resolveKickPublicKey = createKickPublicKeyResolver({
    ...(secrets.kickPublicKeyPem !== undefined
      ? { publicKeyPem: secrets.kickPublicKeyPem }
      : {}),
    ...(secrets.fetchKickPublicKey !== undefined
      ? { fetchImpl: secrets.fetchKickPublicKey }
      : {}),
  });

  app.post("/telegram/webhook", async (request, reply) => {
    try {
      await consumeIp(limiter, request, reply, "webhook:telegram");
      if (!secrets.telegramSecret) {
        throw new ApiError("NOT_READY", "telegram webhook secret is not configured", 503);
      }
      const provided = headerValue(request.headers["x-telegram-bot-api-secret-token"]);
      if (!verifyTelegramWebhookSecret(provided, secrets.telegramSecret)) {
        throw new ApiError("UNAUTHORIZED", "telegram webhook secret is invalid", 401);
      }
      const update = readTelegramUpdate(request.body);
      await persistInboundAndEnqueue(db, {
        provider: "telegram",
        eventType: update.eventType,
        externalEventId: update.externalEventId,
        payload: update.payload,
        signatureValid: true,
        ...(request.correlation?.correlationId
          ? { correlationId: request.correlation.correlationId }
          : {}),
      });
      return { ok: true as const };
    } catch (error) {
      return sendHttpError(reply, error);
    }
  });

  app.post(
    "/kick/webhook",
    {
      preParsing: async (request, _reply, payload) => {
        const chunks: Buffer[] = [];
        for await (const chunk of payload) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks);
        kickRawBodies.set(request, raw);
        return Readable.from(raw);
      },
    },
    async (request, reply) => {
      try {
        await consumeIp(limiter, request, reply, "webhook:kick");
        const messageId = headerValue(request.headers["kick-event-message-id"]);
        const timestamp = headerValue(request.headers["kick-event-message-timestamp"]);
        const signature = headerValue(request.headers["kick-event-signature"]);
        const rawBody = kickRawBodies.get(request);
        if (!messageId) {
          throw new ApiError("BAD_REQUEST", "kick event id is required", 400);
        }
        if (!timestamp || !signature || !rawBody) {
          throw new ApiError("UNAUTHORIZED", "kick webhook signature is invalid", 401);
        }

        let publicKeyPem: string;
        try {
          publicKeyPem = await resolveKickPublicKey();
        } catch {
          throw new ApiError("NOT_READY", "kick public key is unavailable", 503);
        }

        const signatureValid = verifyKickEventSignature({
          messageId,
          timestamp,
          rawBody,
          signature,
          publicKeyPem,
        });
        if (!signatureValid) {
          throw new ApiError("UNAUTHORIZED", "kick webhook signature is invalid", 401);
        }

        const event = readKickEvent(request.headers, request.body);
        await persistInboundAndEnqueue(db, {
          provider: "kick",
          eventType: event.eventType,
          externalEventId: event.externalEventId,
          payload: event.payload,
          signatureValid: true,
          ...(request.correlation?.correlationId
            ? { correlationId: request.correlation.correlationId }
            : {}),
        });
        return { ok: true as const };
      } catch (error) {
        return sendHttpError(reply, error);
      }
    },
  );
}
