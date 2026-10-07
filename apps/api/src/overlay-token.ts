import { OverlayUnauthorizedError } from "@giftbot/domain";
import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.js";

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function readOverlayToken(
  query: Record<string, unknown>,
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const fromQuery = query.token;
  if (typeof fromQuery === "string" && fromQuery.length > 0) {
    return fromQuery;
  }
  const fromHeader = headerValue(headers["x-stream-alerts-token"]);
  if (fromHeader && fromHeader.length > 0) {
    return fromHeader;
  }
  return undefined;
}

export function assertOverlayToken(
  provided: string | undefined,
  expected: string | undefined,
): void {
  if (!expected) {
    throw new ApiError(
      "STREAM_ALERTS_UNAVAILABLE",
      "stream alerts overlay is not configured",
      503,
    );
  }
  const left = createHash("sha256")
    .update(provided ?? "", "utf8")
    .digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  if (!timingSafeEqual(left, right)) {
    throw new OverlayUnauthorizedError();
  }
}
