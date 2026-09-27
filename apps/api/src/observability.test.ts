import {
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { inboundEvents, jobs } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN";
const policy = createAuthPolicy(botToken);
const telegramSecret = "telegram-secret";

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55443 });
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

test("live is not ready and health plus metrics do not write", async () => {
  const inboundBefore = (await db.select().from(inboundEvents)).length;
  const jobsBefore = (await db.select().from(jobs)).length;
  const app = createApiApp({ db, authPolicy: policy });
  const live = await app.inject({
    method: "GET",
    url: "/health/live",
    headers: { "x-request-id": "health-req-1" },
  });
  const ready = await app.inject({ method: "GET", url: "/health/ready" });
  const scraped = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), { status: "live", process: "api" });
  assert.equal(live.headers["x-request-id"], "health-req-1");
  assert.equal(ready.statusCode, 200);
  assert.notEqual(ready.json().status, live.json().status);
  assert.equal(scraped.statusCode, 200);
  assert.equal((scraped.json() as { process: string }).process, "api");
  assert.equal((await db.select().from(inboundEvents)).length, inboundBefore);
  assert.equal((await db.select().from(jobs)).length, jobsBefore);
  await app.close();
});

test("webhook request id is stored on the inbound event and job", async () => {
  const app = createApiApp({
    db,
    authPolicy: policy,
    webhook: { telegramSecret },
  });
  const posted = await app.inject({
    method: "POST",
    url: "/telegram/webhook",
    headers: {
      "x-telegram-bot-api-secret-token": telegramSecret,
      "x-request-id": "req-trace-12",
    },
    payload: { update_id: 12012, message: { text: "/start" } },
  });
  assert.equal(posted.statusCode, 200);
  assert.equal(posted.headers["x-request-id"], "req-trace-12");
  const event = (
    await db
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.externalEventId, "12012"))
  )[0];
  assert.ok(event);
  assert.equal(event.correlationId, "req-trace-12");
  const job = (
    await db.select().from(jobs).where(eq(jobs.id, event.jobId ?? ""))
  )[0];
  assert.ok(job);
  assert.equal(job.correlationId, "req-trace-12");
  assert.deepEqual(job.payload, { inbound_event_id: event.id });
  await app.close();
});
