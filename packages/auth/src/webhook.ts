import { timingSafeEqual } from "node:crypto";

export function verifySharedSecret(
  provided: string | undefined,
  expected: string,
): boolean {
  if (!provided) {
    return false;
  }
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export const verifyTelegramWebhookSecret = verifySharedSecret;
