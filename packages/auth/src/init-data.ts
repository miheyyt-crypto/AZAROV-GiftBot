import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthDateExpiredError, InvalidInitDataError } from "./errors.js";
import { AUTH_DATE_MAX_FUTURE_SKEW_SECONDS } from "./policy.js";

export type TelegramInitUser = {
  telegramUserId: bigint;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  isPremium?: boolean;
  photoUrl?: string;
};

export type VerifiedInitData = {
  user: TelegramInitUser;
  authDate: Date;
};

function hmacSha256(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  if (a.length === 0 || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  now: Date,
  maxAgeSeconds: number,
): VerifiedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new InvalidInitDataError("hash is missing");
  }
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secretKey = hmacSha256("WebAppData", botToken);
  const computed = hmacSha256(secretKey, dataCheckString).toString("hex");
  if (!safeEqualHex(computed, hash)) {
    throw new InvalidInitDataError("signature mismatch");
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw || !/^\d+$/.test(authDateRaw)) {
    throw new InvalidInitDataError("auth_date is missing");
  }
  const authDate = new Date(Number(authDateRaw) * 1000);
  // ageSeconds > maxAgeSeconds → too old (boundary: age === maxAgeSeconds accepted)
  // ageSeconds < -AUTH_DATE_MAX_FUTURE_SKEW_SECONDS → auth_date too far in the future
  const ageSeconds = Math.floor((now.getTime() - authDate.getTime()) / 1000);
  if (
    ageSeconds > maxAgeSeconds ||
    ageSeconds < -AUTH_DATE_MAX_FUTURE_SKEW_SECONDS
  ) {
    throw new AuthDateExpiredError();
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    throw new InvalidInitDataError("user is missing");
  }

  let parsed: {
    id?: number | string;
    username?: string;
    first_name?: string;
    last_name?: string;
    language_code?: string;
    is_premium?: boolean;
    photo_url?: string;
  };
  try {
    parsed = JSON.parse(userRaw) as typeof parsed;
  } catch {
    throw new InvalidInitDataError("user is not valid JSON");
  }
  if (parsed.id === undefined) {
    throw new InvalidInitDataError("user.id is missing");
  }

  const user: TelegramInitUser = {
    telegramUserId: BigInt(parsed.id),
  };
  if (parsed.username) {
    user.username = parsed.username;
  }
  if (parsed.first_name) {
    user.firstName = parsed.first_name;
  }
  if (parsed.last_name) {
    user.lastName = parsed.last_name;
  }
  if (parsed.language_code) {
    user.languageCode = parsed.language_code;
  }
  if (parsed.is_premium !== undefined) {
    user.isPremium = parsed.is_premium;
  }
  if (typeof parsed.photo_url === "string") {
    user.photoUrl = parsed.photo_url;
  }

  return { user, authDate };
}

export function buildSignedInitData(
  botToken: string,
  user: Record<string, unknown>,
  authDateUnix: number,
): string {
  const params = new URLSearchParams();
  params.set("auth_date", String(authDateUnix));
  params.set("user", JSON.stringify(user));
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secretKey = hmacSha256("WebAppData", botToken);
  const hash = hmacSha256(secretKey, dataCheckString).toString("hex");
  params.set("hash", hash);
  return params.toString();
}
