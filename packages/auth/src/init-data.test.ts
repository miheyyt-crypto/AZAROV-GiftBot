import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthDateExpiredError, InvalidInitDataError } from "./errors.js";
import { buildSignedInitData, verifyTelegramInitData } from "./init-data.js";
import {
  AUTH_DATE_MAX_FUTURE_SKEW_SECONDS,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
} from "./policy.js";

const botToken = "123456:TEST-BOT-TOKEN";
const maxAge = TELEGRAM_INIT_DATA_MAX_AGE_SECONDS;

test("accepts a valid HMAC initData payload", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const initData = buildSignedInitData(
    botToken,
    { id: 42, first_name: "Ada", username: "ada" },
    Math.floor(now.getTime() / 1000),
  );
  const verified = verifyTelegramInitData(initData, botToken, now, maxAge);
  assert.equal(verified.user.telegramUserId, 42n);
  assert.equal(verified.user.firstName, "Ada");
  assert.equal(verified.user.username, "ada");
  assert.equal(verified.user.photoUrl, undefined);
});

test("extracts photo_url from signed user JSON", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const initData = buildSignedInitData(
    botToken,
    {
      id: 42,
      first_name: "Ada",
      photo_url: "https://t.me/i/userpic/320/ada.jpg",
    },
    Math.floor(now.getTime() / 1000),
  );
  const verified = verifyTelegramInitData(initData, botToken, now, maxAge);
  assert.equal(verified.user.photoUrl, "https://t.me/i/userpic/320/ada.jpg");
});

test("rejects a tampered hash", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const initData = buildSignedInitData(
    botToken,
    { id: 42 },
    Math.floor(now.getTime() / 1000),
  );
  const params = new URLSearchParams(initData);
  params.set("hash", "0".repeat(64));
  const tampered = params.toString();
  assert.throws(
    () => verifyTelegramInitData(tampered, botToken, now, maxAge),
    InvalidInitDataError,
  );
});

test("accepts initData age 1799 seconds (under 30m max)", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const authUnix = Math.floor(now.getTime() / 1000) - 1_799;
  const initData = buildSignedInitData(botToken, { id: 42 }, authUnix);
  assert.doesNotThrow(() =>
    verifyTelegramInitData(initData, botToken, now, maxAge),
  );
});

test("accepts initData age exactly maxAgeSeconds (boundary inclusive)", () => {
  // Implementation: reject only when ageSeconds > maxAgeSeconds.
  const now = new Date("2026-09-13T12:00:00.000Z");
  const authUnix = Math.floor(now.getTime() / 1000) - maxAge;
  const initData = buildSignedInitData(botToken, { id: 42 }, authUnix);
  assert.doesNotThrow(() =>
    verifyTelegramInitData(initData, botToken, now, maxAge),
  );
});

test("rejects initData age greater than maxAgeSeconds", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const authUnix = Math.floor(now.getTime() / 1000) - (maxAge + 1);
  const initData = buildSignedInitData(botToken, { id: 42 }, authUnix);
  assert.throws(
    () => verifyTelegramInitData(initData, botToken, now, maxAge),
    AuthDateExpiredError,
  );
});

test("rejects auth_date more than 60 seconds in the future", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const authUnix =
    Math.floor(now.getTime() / 1000) + AUTH_DATE_MAX_FUTURE_SKEW_SECONDS + 1;
  const initData = buildSignedInitData(botToken, { id: 42 }, authUnix);
  assert.throws(
    () => verifyTelegramInitData(initData, botToken, now, maxAge),
    AuthDateExpiredError,
  );
});

test("accepts auth_date exactly 60 seconds in the future (skew boundary)", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const authUnix =
    Math.floor(now.getTime() / 1000) + AUTH_DATE_MAX_FUTURE_SKEW_SECONDS;
  const initData = buildSignedInitData(botToken, { id: 42 }, authUnix);
  assert.doesNotThrow(() =>
    verifyTelegramInitData(initData, botToken, now, maxAge),
  );
});
