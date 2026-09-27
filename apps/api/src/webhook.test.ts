import {
  buildKickSignedMessage,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { inboundEvents, jobs, walletTransactions } from "@giftbot/db/schema";
import { JOB_TYPES } from "@giftbot/jobs";
import { createMemoryRateLimiter } from "@giftbot/rate-limit";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import {
  constants,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN";
const policy = createAuthPolicy(botToken);
const telegramSecret = "telegram-secret";
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55437 });
  await runMigrations(postgres.url);
  const handle = createDb(postgres.url);
  db = handle.db;
  sqlEnd = async () => {
    await handle.sql.end({ timeout: 5 });
  };
});

after(async () => {
  await sqlEnd();
  await postgres.stop();
});

function appWithSecrets() {
  return createApiApp({
    db,
    authPolicy: policy,
    webhook: { telegramSecret, kickPublicKeyPem: publicKey },
  });
}

function signKick(
  messageId: string,
  timestamp: string,
  rawBody: string,
): string {
  return sign(
    "sha256",
    buildKickSignedMessage(messageId, timestamp, Buffer.from(rawBody)),
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_PADDING,
    },
  ).toString("base64");
}

function kickHeaders(input: {
  messageId: string;
  timestamp: string;
  rawBody: string;
  signature?: string;
  eventType?: string;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    "kick-event-message-id": input.messageId,
    "kick-event-message-timestamp": input.timestamp,
    "kick-event-signature":
      input.signature ?? signKick(input.messageId, input.timestamp, input.rawBody),
    "kick-event-type": input.eventType ?? "channel.subscription",
  };
}

test("Telegram webhook persists one event and a bot job, then replays", async () => {
  const app = appWithSecrets();
  const payload = { update_id: 501, message: { text: "/start" } };
  const first = await app.inject({
    method: "POST",
    url: "/telegram/webhook",
    headers: { "x-telegram-bot-api-secret-token": telegramSecret },
    payload,
  });
  const replay = await app.inject({
    method: "POST",
    url: "/telegram/webhook",
    headers: { "x-telegram-bot-api-secret-token": telegramSecret },
    payload,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);

  const events = await db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.externalEventId, "501"));
  const jobRows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.type, JOB_TYPES.telegramProcessInbound));
  assert.equal(events.length, 1);
  assert.equal(jobRows.length, 1);
  assert.equal(jobRows[0]?.owner, "bot");
  assert.deepEqual(jobRows[0]?.payload, { inbound_event_id: events[0]?.id });
  assert.equal((await db.select().from(walletTransactions)).length, 0);
  await app.close();
});

test("invalid Telegram secret is 401 and stores nothing", async () => {
  const app = appWithSecrets();
  const before = (await db.select().from(inboundEvents)).length;
  const response = await app.inject({
    method: "POST",
    url: "/telegram/webhook",
    headers: { "x-telegram-bot-api-secret-token": "wrong" },
    payload: { update_id: 777, message: { text: "hi" } },
  });
  assert.equal(response.statusCode, 401);
  assert.equal((await db.select().from(inboundEvents)).length, before);
  await app.close();
});

test("valid Kick signature is accepted, persisted, and enqueued once", async () => {
  const app = appWithSecrets();
  const messageId = "01JVALIDKICKEVENT0000000001";
  const timestamp = "2026-09-13T14:30:00Z";
  const rawBody = '{"hello":true}';
  const ok = await app.inject({
    method: "POST",
    url: "/kick/webhook",
    headers: kickHeaders({ messageId, timestamp, rawBody }),
    payload: rawBody,
  });
  assert.equal(ok.statusCode, 200);
  const events = await db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.externalEventId, messageId));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.signatureValid, true);
  assert.equal(events[0]?.provider, "kick");
  const jobRows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.type, JOB_TYPES.kickProcessInbound));
  assert.equal(jobRows.length, 1);
  assert.equal(jobRows[0]?.owner, "worker");
  assert.deepEqual(jobRows[0]?.payload, { inbound_event_id: events[0]?.id });
  assert.equal((await db.select().from(walletTransactions)).length, 0);
  await app.close();
});

test("duplicate valid Kick event remains idempotent", async () => {
  const app = appWithSecrets();
  const messageId = "01JDUPLICATEKICKEVENT000000";
  const timestamp = "2026-09-13T14:30:00Z";
  const rawBody = '{"hello":true}';
  const headers = kickHeaders({ messageId, timestamp, rawBody });
  const first = await app.inject({
    method: "POST",
    url: "/kick/webhook",
    headers,
    payload: rawBody,
  });
  const replay = await app.inject({
    method: "POST",
    url: "/kick/webhook",
    headers,
    payload: rawBody,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);
  const events = await db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.externalEventId, messageId));
  const jobRows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.inboundEventId, events[0]?.id ?? ""));
  assert.equal(events.length, 1);
  assert.equal(jobRows.length, 1);
  await app.close();
});

test("invalid Kick signature is 401 and stores nothing", async () => {
  const app = appWithSecrets();
  const before = (await db.select().from(inboundEvents)).length;
  const messageId = "01JINVALIDKICKEVENT0000000";
  const timestamp = "2026-09-13T14:30:00Z";
  const rawBody = '{"hello":true}';
  const response = await app.inject({
    method: "POST",
    url: "/kick/webhook",
    headers: kickHeaders({
      messageId,
      timestamp,
      rawBody,
      signature: signKick(messageId, timestamp, '{"hello":false}'),
    }),
    payload: rawBody,
  });
  assert.equal(response.statusCode, 401);
  assert.equal((await db.select().from(inboundEvents)).length, before);
  const stored = await db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.externalEventId, messageId));
  assert.equal(stored.length, 0);
  await app.close();
});

test("missing Kick signature is 401 and stores nothing", async () => {
  const app = appWithSecrets();
  const before = (await db.select().from(inboundEvents)).length;
  const response = await app.inject({
    method: "POST",
    url: "/kick/webhook",
    headers: {
      "content-type": "application/json",
      "kick-event-message-id": "01JMISSINGKICKSIGNATURE000",
      "kick-event-message-timestamp": "2026-09-13T14:30:00Z",
      "kick-event-type": "channel.subscription",
    },
    payload: '{"hello":true}',
  });
  assert.equal(response.statusCode, 401);
  assert.equal((await db.select().from(inboundEvents)).length, before);
  await app.close();
});

test("changed Kick raw body is 401 and stores nothing", async () => {
  const app = appWithSecrets();
  const before = (await db.select().from(inboundEvents)).length;
  const messageId = "01JCHANGEDKICKBODY00000000";
  const timestamp = "2026-09-13T14:30:00Z";
  const rawBody = '{"hello":true}';
  const response = await app.inject({
    method: "POST",
    url: "/kick/webhook",
    headers: kickHeaders({ messageId, timestamp, rawBody }),
    payload: '{"hello":false}',
  });
  assert.equal(response.statusCode, 401);
  assert.equal((await db.select().from(inboundEvents)).length, before);
  await app.close();
});

test("changed Kick message ID is 401 and stores nothing", async () => {
  const app = appWithSecrets();
  const before = (await db.select().from(inboundEvents)).length;
  const timestamp = "2026-09-13T14:30:00Z";
  const rawBody = '{"hello":true}';
  const response = await app.inject({
    method: "POST",
    url: "/kick/webhook",
    headers: kickHeaders({
      messageId: "01JCHANGEDKICKID0000000000",
      timestamp,
      rawBody,
      signature: signKick("01JORIGINALKICKID000000000", timestamp, rawBody),
    }),
    payload: rawBody,
  });
  assert.equal(response.statusCode, 401);
  assert.equal((await db.select().from(inboundEvents)).length, before);
  await app.close();
});

test("changed Kick timestamp is 401 and stores nothing", async () => {
  const app = appWithSecrets();
  const before = (await db.select().from(inboundEvents)).length;
  const messageId = "01JCHANGEDKICKTS0000000000";
  const rawBody = '{"hello":true}';
  const response = await app.inject({
    method: "POST",
    url: "/kick/webhook",
    headers: kickHeaders({
      messageId,
      timestamp: "2020-01-01T00:00:00Z",
      rawBody,
      signature: signKick(messageId, "2026-09-13T14:30:00Z", rawBody),
    }),
    payload: rawBody,
  });
  assert.equal(response.statusCode, 401);
  assert.equal((await db.select().from(inboundEvents)).length, before);
  await app.close();
});

test("Kick webhook rejects a missing event id", async () => {
  const app = appWithSecrets();
  const missingId = await app.inject({
    method: "POST",
    url: "/kick/webhook",
    headers: {
      "content-type": "application/json",
      "kick-event-signature": "AAAA",
      "kick-event-message-timestamp": "2026-09-13T14:30:00Z",
    },
    payload: '{"hello":true}',
  });
  assert.equal(missingId.statusCode, 400);
  await app.close();
});

test("webhook rate limiter can return 429 without a second persist", async () => {
  const app = createApiApp({
    db,
    authPolicy: policy,
    webhook: { telegramSecret, kickPublicKeyPem: publicKey },
    webhookRateLimiter: createMemoryRateLimiter({
      windowSeconds: 60,
      maxRequests: 1,
    }),
  });
  const headers = { "x-telegram-bot-api-secret-token": telegramSecret };
  const allowed = await app.inject({
    method: "POST",
    url: "/telegram/webhook",
    headers,
    payload: { update_id: 9001, message: { text: "one" } },
  });
  const limited = await app.inject({
    method: "POST",
    url: "/telegram/webhook",
    headers,
    payload: { update_id: 9002, message: { text: "two" } },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(limited.statusCode, 429);
  const extra = await db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.externalEventId, "9002"));
  assert.equal(extra.length, 0);
  await app.close();
});
