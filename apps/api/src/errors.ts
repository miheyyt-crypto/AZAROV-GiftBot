import { AuthError } from "@giftbot/auth";
import {
  ConflictError,
  DomainError,
  InsufficientFundsError,
  InvalidAmountError,
  NotFoundError,
  TaskVerificationUnavailableError,
  WalletFrozenError,
} from "@giftbot/domain";
import { IdempotencyConflictError } from "@giftbot/jobs";
import type { FastifyReply } from "fastify";

export class ApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function sendHttpError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AuthError || error instanceof ApiError) {
    return reply.code(error.httpStatus).send({
      error: error.code,
      message: error.message,
    });
  }
  if (error instanceof IdempotencyConflictError) {
    return reply.code(409).send({
      error: "IDEMPOTENCY_CONFLICT",
      message: error.message,
    });
  }
  if (error instanceof TaskVerificationUnavailableError) {
    return reply.code(503).send({
      error: error.code,
      message: error.message,
    });
  }
  if (error instanceof ConflictError) {
    const body: Record<string, unknown> = {
      error: error.code,
      message: error.message,
    };
    if (
      "nextAvailableAt" in error &&
      typeof (error as { nextAvailableAt?: unknown }).nextAvailableAt === "string"
    ) {
      body.nextAvailableAt = (error as { nextAvailableAt: string }).nextAvailableAt;
    }
    return reply.code(409).send(body);
  }
  if (error instanceof NotFoundError) {
    return reply.code(404).send({
      error: error.code,
      message: error.message,
    });
  }
  if (
    error instanceof InsufficientFundsError ||
    error instanceof WalletFrozenError
  ) {
    return reply.code(409).send({
      error: error.code,
      message: error.message,
    });
  }
  if (error instanceof InvalidAmountError) {
    return reply.code(400).send({
      error: error.code,
      message: error.message,
    });
  }
  if (error instanceof DomainError) {
    return reply.code(400).send({
      error: error.code,
      message: error.message,
    });
  }
  throw error;
}
