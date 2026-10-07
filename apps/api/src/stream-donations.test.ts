import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import {
  adminRoleAssignments,
  adminRoles,
  streamAlertConsumers,
  streamDonations,
} from "@giftbot/db/schema";
import {
  apply,
  STREAM_DONATION_PLAYING_LEASE_MS,
} from "@giftbot/domain";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN";
const policy = createAuthPolicy(botToken);
const OVERLAY_TOKEN = "overlay-secret-token1";

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55531 });
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

afterEach(async () => {
  await db.delete(streamDonations);
  await db.delete(streamAlertConsumers);
});

function signedInitData(telegramUserId: number, username?: string): string {
  return buildSignedInitData(
    botToken,
    {
      id: telegramUserId,
      first_name: "Donor",
      ...(username ? { username } : {}),
    },
    Math.floor(Date.now() / 1000),
  );
}

async function assignSuperAdmin(userId: string): Promise<void> {
  const roles = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, "super_admin"))
    .limit(1);
  const role = roles[0];
  assert.ok(role);
  await db.insert(adminRoleAssignments).values({
    userId,
    roleId: role.id,
  });
}

async function miniToken(
  telegramUserId: number,
  username = "streamuser",
): Promise<{ token: string; userId: string }> {
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(telegramUserId, username) },
  });
  const body = created.json() as { token: string; user: { userId: string } };
  await app.close();
  return { token: body.token, userId: body.user.userId };
}

async function adminToken(telegramUserId: number): Promise<{
  token: string;
  userId: string;
}> {
  const mini = await miniToken(telegramUserId, "adminstream");
  await assignSuperAdmin(mini.userId);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/admin/auth",
    payload: { initData: signedInitData(telegramUserId, "adminstream") },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as { token: string };
  await app.close();
  return { token: body.token, userId: mini.userId };
}

async function credit(userId: string, amount: bigint, key: string): Promise<void> {
  await apply(db, {
    userId,
    type: "deposit",
    amountMinor: amount,
    idempotencyKey: key,
    actorType: "system",
  });
}

function appWithOverlay() {
  return createApiApp({
    db,
    authPolicy: policy,
    overlayAlertsToken: OVERLAY_TOKEN,
  });
}

test("POST /stream-donations requires auth", async () => {
  const app = appWithOverlay();
  const response = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: { "idempotency-key": randomUUID() },
    payload: { message: "hi" },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("1500 AZC donation leaves 500 and uses session identity", async () => {
  const mini = await miniToken(982001, "realnick");
  await credit(mini.userId, 1500n, `dep:${mini.userId}:1500`);
  const app = appWithOverlay();
  const response = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: {
      message: "  hello  ",
      userId: randomUUID(),
      displayName: "@hacker",
    },
  });
  assert.equal(response.statusCode, 400);
  const ok = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: { message: "  hello  " },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as {
    newBalanceAzc: string;
    displayName: string;
    message: string;
    amountAzc: string;
  };
  assert.equal(body.newBalanceAzc, "500");
  assert.equal(body.displayName, "@realnick");
  assert.equal(body.message, "hello");
  assert.equal(body.amountAzc, "1000");
  await app.close();
});

test("999 AZC donation is rejected", async () => {
  const mini = await miniToken(982002);
  await credit(mini.userId, 999n, `dep:${mini.userId}:999`);
  const app = appWithOverlay();
  const response = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: { message: "nope" },
  });
  assert.equal(response.statusCode, 409);
  await app.close();
});

test("duplicate Idempotency-Key does not double-charge", async () => {
  const mini = await miniToken(982003);
  await credit(mini.userId, 3000n, `dep:${mini.userId}:3000`);
  const key = randomUUID();
  const app = appWithOverlay();
  const first = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": key,
    },
    payload: { message: "once" },
  });
  const second = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": key,
    },
    payload: { message: "once" },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  const a = first.json() as { id: string; newBalanceAzc: string };
  const b = second.json() as { id: string; replayed: boolean; newBalanceAzc: string };
  assert.equal(a.id, b.id);
  assert.equal(b.replayed, true);
  assert.equal(a.newBalanceAzc, "2000");
  assert.equal(b.newBalanceAzc, "2000");
  await app.close();
});

test("empty and oversized messages are rejected", async () => {
  const mini = await miniToken(982004);
  await credit(mini.userId, 2000n, `dep:${mini.userId}:msg`);
  const app = appWithOverlay();
  const empty = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: { message: "   " },
  });
  const long = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: { message: "x".repeat(201) },
  });
  assert.equal(empty.statusCode, 400);
  assert.equal(long.statusCode, 400);
  await app.close();
});

test("overlay token is required and FIFO claim then finish", async () => {
  const mini = await miniToken(982005, "fifo");
  await credit(mini.userId, 3000n, `dep:${mini.userId}:fifo`);
  const app = appWithOverlay();
  const denied = await app.inject({
    method: "POST",
    url: "/stream-alerts/attach",
    payload: { sessionId: randomUUID() },
  });
  assert.equal(denied.statusCode, 401);
  const unconfigured = createApiApp({
    db,
    authPolicy: policy,
    overlayAlertsToken: "",
  });
  const missing = await unconfigured.inject({
    method: "POST",
    url: "/stream-alerts/attach?token=overlay-secret-token1",
    payload: { sessionId: randomUUID() },
  });
  assert.equal(missing.statusCode, 503);
  await unconfigured.close();

  const first = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: { message: "A" },
  });
  const second = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: { message: "B" },
  });
  const a = first.json() as { id: string };
  const b = second.json() as { id: string };
  const sessionId = randomUUID();
  const attached = await app.inject({
    method: "POST",
    url: `/stream-alerts/attach?token=${OVERLAY_TOKEN}`,
    payload: { sessionId },
  });
  assert.equal(attached.statusCode, 200);
  const busy = await app.inject({
    method: "POST",
    url: `/stream-alerts/attach?token=${OVERLAY_TOKEN}`,
    payload: { sessionId: randomUUID() },
  });
  assert.equal(busy.statusCode, 409);
  const claimA = await app.inject({
    method: "POST",
    url: `/stream-alerts/claim?token=${OVERLAY_TOKEN}`,
    payload: { sessionId },
  });
  const claimedA = claimA.json() as { donation: { id: string } | null };
  assert.equal(claimedA.donation?.id, a.id);
  await app.inject({
    method: "POST",
    url: `/stream-alerts/complete?token=${OVERLAY_TOKEN}`,
    payload: { sessionId, donationId: a.id },
  });
  const claimB = await app.inject({
    method: "POST",
    url: `/stream-alerts/claim?token=${OVERLAY_TOKEN}`,
    payload: { sessionId },
  });
  const claimedB = claimB.json() as { donation: { id: string } | null };
  assert.equal(claimedB.donation?.id, b.id);
  await app.inject({
    method: "POST",
    url: `/stream-alerts/complete?token=${OVERLAY_TOKEN}`,
    payload: { sessionId, donationId: b.id },
  });
  const empty = await app.inject({
    method: "POST",
    url: `/stream-alerts/claim?token=${OVERLAY_TOKEN}`,
    payload: { sessionId },
  });
  assert.equal(empty.json().donation, null);
  await app.close();
});

test("expired playing donation is recovered", async () => {
  const mini = await miniToken(982006);
  await credit(mini.userId, 1000n, `dep:${mini.userId}:lease`);
  const app = appWithOverlay();
  const created = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: { message: "hold" },
  });
  const donation = created.json() as { id: string };
  const sessionId = randomUUID();
  await app.inject({
    method: "POST",
    url: `/stream-alerts/attach?token=${OVERLAY_TOKEN}`,
    payload: { sessionId },
  });
  await app.inject({
    method: "POST",
    url: `/stream-alerts/claim?token=${OVERLAY_TOKEN}`,
    payload: { sessionId },
  });
  const startedAt = new Date(
    Date.now() - STREAM_DONATION_PLAYING_LEASE_MS - 1000,
  );
  await db
    .update(streamDonations)
    .set({ startedAt })
    .where(eq(streamDonations.id, donation.id));
  await db.delete(streamAlertConsumers);
  const later = randomUUID();
  const attachedLater = await app.inject({
    method: "POST",
    url: `/stream-alerts/attach?token=${OVERLAY_TOKEN}`,
    payload: { sessionId: later },
  });
  const recovered = await app.inject({
    method: "POST",
    url: `/stream-alerts/claim?token=${OVERLAY_TOKEN}`,
    payload: { sessionId: later },
  });
  const attachedBody = attachedLater.json() as { recovered: number };
  const body = recovered.json() as {
    donation: { id: string } | null;
    recovered: number;
  };
  assert.equal(body.donation?.id, donation.id);
  assert.ok(attachedBody.recovered + body.recovered >= 1);
  await app.close();
});

test("admin can list donations", async () => {
  const mini = await miniToken(982007, "hist");
  await credit(mini.userId, 1000n, `dep:${mini.userId}:hist`);
  const admin = await adminToken(982008);
  const app = appWithOverlay();
  await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: { message: "listed" },
  });
  const listed = await app.inject({
    method: "GET",
    url: "/admin/stream-donations",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  assert.equal(listed.statusCode, 200);
  const body = listed.json() as { items: Array<{ message: string }> };
  assert.ok(body.items.some((item) => item.message === "listed"));
  const me = await app.inject({
    method: "GET",
    url: "/stream-donations/me",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(me.statusCode, 200);
  await app.close();
});
