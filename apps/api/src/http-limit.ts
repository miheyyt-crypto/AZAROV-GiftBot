import type { FastifyReply, FastifyRequest } from "fastify";
import type { RateLimiter } from "@giftbot/rate-limit";
import { ApiError } from "./errors.js";

export type RateLimitMeta = {
  bucket: string;
  keyType: "ip" | "user";
};

declare module "fastify" {
  interface FastifyRequest {
    rateLimit?: RateLimitMeta;
  }
}

export async function consumeLimit(
  limiter: RateLimiter | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
  bucket: string,
  keyType: "ip" | "user",
  id: string,
): Promise<void> {
  request.rateLimit = { bucket, keyType };
  if (!limiter) {
    return;
  }
  const decision = await limiter.consume(`${bucket}:${keyType}:${id}`);
  if (!decision.allowed) {
    reply.header("retry-after", String(decision.retryAfterSeconds));
    throw new ApiError("RATE_LIMITED", "too many requests", 429);
  }
}

export async function consumeIp(
  limiter: RateLimiter | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
  bucket: string,
): Promise<void> {
  await consumeLimit(limiter, request, reply, bucket, "ip", request.ip);
}

export async function consumeUser(
  limiter: RateLimiter | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
  bucket: string,
  userId: string,
): Promise<void> {
  await consumeLimit(limiter, request, reply, bucket, "user", userId);
}

/** Authenticated Mini App traffic: GET uses `:read:`, mutations use `:write:`. */
export async function consumeAuthed(
  limiter: RateLimiter | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
  bucket: string,
  userId: string,
): Promise<void> {
  const kind =
    request.method === "GET" || request.method === "HEAD" ? "read" : "write";
  await consumeUser(limiter, request, reply, `${bucket}:${kind}`, userId);
}
