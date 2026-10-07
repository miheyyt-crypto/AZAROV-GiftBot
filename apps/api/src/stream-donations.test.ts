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
  encodePcmWav,
  ensureShopCatalog,
  STREAM_DONATION_PLAYING_LEASE_MS,
} from "@giftbot/domain";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  await ensureShopCatalog(db);
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

async function buyDonat(
  app: ReturnType<typeof createApiApp>,
  token: string,
  message: string,
  key: string,
  extra: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": key,
    },
    payload: {
      productCode: "donat",
      submittedData: { displayNickname: "FormNick", donationText: message },
      ...extra,
    },
  });
}

async function streamRowForOrder(orderId: string) {
  const rows = await db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.shopPurchaseId, orderId));
  return rows[0];
}

test("legacy POST /stream-donations is not a purchase endpoint", async () => {
  const app = appWithOverlay();
  const response = await app.inject({
    method: "POST",
    url: "/stream-donations",
    headers: { "idempotency-key": randomUUID() },
    payload: { message: "hi" },
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test("shop donat purchase leaves 500 and uses session identity", async () => {
  const mini = await miniToken(982001, "realnick");
  await credit(mini.userId, 1500n, `dep:${mini.userId}:1500`);
  const app = appWithOverlay();
  const ok = await buyDonat(app, mini.token, "  hello  ", randomUUID(), {
    userId: randomUUID(),
    displayName: "@hacker",
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as {
    status: string;
    orderId: string;
    newBalanceAzc: string;
    priceAzc: string;
    productCode: string;
  };
  assert.equal(body.status, "fulfilled");
  assert.equal(body.productCode, "donat");
  assert.equal(body.newBalanceAzc, "500");
  assert.equal(body.priceAzc, "1000");
  const donation = await streamRowForOrder(body.orderId);
  assert.ok(donation);
  assert.equal(donation.displayName, "FormNick");
  assert.notEqual(donation.displayName, "@realnick");
  assert.equal(donation.message, "hello");
  assert.equal(donation.amountAzc.toString(), "1000");
  await app.close();
});

test("999 AZC shop donat is rejected", async () => {
  const mini = await miniToken(982002);
  await credit(mini.userId, 999n, `dep:${mini.userId}:999`);
  const app = appWithOverlay();
  const response = await buyDonat(app, mini.token, "nope", randomUUID());
  assert.equal(response.statusCode, 409);
  assert.equal(
    (response.json() as { error: string }).error,
    "SHOP_INSUFFICIENT_BALANCE",
  );
  const rows = await db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.userId, mini.userId));
  assert.equal(rows.length, 0);
  await app.close();
});

test("duplicate shop Idempotency-Key does not double-charge or double-alert", async () => {
  const mini = await miniToken(982003);
  await credit(mini.userId, 3000n, `dep:${mini.userId}:3000`);
  const key = randomUUID();
  const app = appWithOverlay();
  const first = await buyDonat(app, mini.token, "once", key);
  const second = await buyDonat(app, mini.token, "once", key);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  const a = first.json() as { orderId: string; newBalanceAzc: string };
  const b = second.json() as {
    orderId: string;
    replayed: boolean;
    newBalanceAzc: string;
  };
  assert.equal(a.orderId, b.orderId);
  assert.equal(b.replayed, true);
  assert.equal(a.newBalanceAzc, "2000");
  assert.equal(b.newBalanceAzc, "2000");
  const rows = await db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.userId, mini.userId));
  assert.equal(rows.length, 1);
  await app.close();
});

test("empty and oversized shop donation messages are rejected", async () => {
  const mini = await miniToken(982004);
  await credit(mini.userId, 2000n, `dep:${mini.userId}:msg`);
  const app = appWithOverlay();
  const empty = await buyDonat(app, mini.token, "   ", randomUUID());
  const long = await buyDonat(app, mini.token, "x".repeat(301), randomUUID());
  assert.equal(empty.statusCode, 400);
  assert.equal(long.statusCode, 400);
  await app.close();
});

test("music purchase does not enqueue a stream alert", async () => {
  const mini = await miniToken(982009);
  await credit(mini.userId, 4000n, `dep:${mini.userId}:music`);
  const app = appWithOverlay();
  const created = await app.inject({
    method: "POST",
    url: "/shop/orders",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": randomUUID(),
    },
    payload: {
      productCode: "music",
      submittedData: { mediaUrl: "https://soundcloud.com/a/b" },
    },
  });
  assert.equal(created.statusCode, 200);
  assert.equal((created.json() as { status: string }).status, "pending");
  const rows = await db
    .select()
    .from(streamDonations)
    .where(eq(streamDonations.userId, mini.userId));
  assert.equal(rows.length, 0);
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

  const first = await buyDonat(app, mini.token, "A", randomUUID());
  const second = await buyDonat(app, mini.token, "B", randomUUID());
  const a = await streamRowForOrder(
    (first.json() as { orderId: string }).orderId,
  );
  const b = await streamRowForOrder(
    (second.json() as { orderId: string }).orderId,
  );
  assert.ok(a && b);
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
  const created = await buyDonat(app, mini.token, "hold", randomUUID());
  const donation = await streamRowForOrder(
    (created.json() as { orderId: string }).orderId,
  );
  assert.ok(donation);
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
    .set({ startedAt, playingExpiresAt: startedAt })
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

test("overlay audio is token-gated and stays GET-only", async () => {
  const mini = await miniToken(982021, "voice");
  await credit(mini.userId, 1000n, `dep:${mini.userId}:voice`);
  const ttsDir = await mkdtemp(join(tmpdir(), "giftbot-api-tts-"));
  const app = createApiApp({
    db,
    authPolicy: policy,
    overlayAlertsToken: OVERLAY_TOKEN,
    overlayTtsDir: ttsDir,
  });
  const bought = await buyDonat(app, mini.token, "озвучка", randomUUID());
  const donation = await streamRowForOrder(
    (bought.json() as { orderId: string }).orderId,
  );
  assert.ok(donation);
  const pending = await app.inject({
    method: "GET",
    url: `/stream-alerts/audio/${donation.id}?token=${OVERLAY_TOKEN}`,
  });
  assert.equal(pending.statusCode, 202);
  const denied = await app.inject({
    method: "GET",
    url: `/stream-alerts/audio/${donation.id}`,
  });
  assert.equal(denied.statusCode, 401);
  await writeFile(
    join(ttsDir, `${donation.id}.ru_roman.wav`),
    encodePcmWav(new Int16Array(2_205), 22_050),
  );
  await db
    .update(streamDonations)
    .set({ ttsStatus: "ready", ttsVoice: "ru_roman", ttsDurationMs: 100 })
    .where(eq(streamDonations.id, donation.id));
  const ready = await app.inject({
    method: "GET",
    url: `/stream-alerts/audio/${donation.id}?token=${OVERLAY_TOKEN}`,
  });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.headers["content-type"], "audio/wav");
  await app.close();
});

test("admin can list shop-created donations", async () => {
  const mini = await miniToken(982007, "hist");
  await credit(mini.userId, 1000n, `dep:${mini.userId}:hist`);
  const admin = await adminToken(982008);
  const app = appWithOverlay();
  await buyDonat(app, mini.token, "listed", randomUUID());
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
  assert.equal(me.statusCode, 404);
  await app.close();
});
