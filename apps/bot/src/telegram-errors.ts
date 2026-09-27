import { GrammyError } from "grammy";

export class TelegramRetryAfterError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterSeconds: number) {
    super(`telegram retry_after ${retryAfterSeconds}`);
    this.name = "TelegramRetryAfterError";
    this.retryAfterMs = Math.max(1, retryAfterSeconds) * 1000;
  }
}

export class TelegramPermanentSendError extends Error {
  readonly httpCode: number;

  constructor(httpCode: number, message: string) {
    super(message);
    this.name = "TelegramPermanentSendError";
    this.httpCode = httpCode;
  }
}

function descriptionOf(error: unknown): string {
  if (error instanceof GrammyError) {
    return `${error.description} ${error.message}`.toLowerCase();
  }
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return String(error).toLowerCase();
}

function codeOf(error: unknown): number | undefined {
  if (error instanceof GrammyError) {
    return error.error_code;
  }
  return undefined;
}

export function classifyTelegramSendError(error: unknown): never | void {
  const code = codeOf(error);
  const description = descriptionOf(error);
  if (code === 429 || description.includes("retry after") || description.includes("too many requests")) {
    const match = /retry after (\d+)/i.exec(description);
    const seconds =
      error instanceof GrammyError &&
      typeof error.parameters?.retry_after === "number"
        ? error.parameters.retry_after
        : Number(match?.[1] ?? 1);
    throw new TelegramRetryAfterError(Number.isFinite(seconds) ? seconds : 1);
  }
  const blockedText =
    description.includes("blocked") ||
    description.includes("deactivated") ||
    description.includes("chat not found") ||
    description.includes("forbidden") ||
    description.includes("user is deactivated") ||
    description.includes("bot was kicked") ||
    description.includes("peer_id_invalid");
  if (code === 403 || code === 400 && blockedText || (code === undefined && blockedText)) {
    throw new TelegramPermanentSendError(code ?? 403, description);
  }
}

export function rethrowClassifiedTelegramError(error: unknown): never {
  classifyTelegramSendError(error);
  throw error;
}
