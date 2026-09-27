import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import {
  adminRoleAssignments,
  adminRoles,
  jobs,
  telegramAccounts,
} from "@giftbot/db/schema";
import { TELEGRAM_CAPTION_MAX_LENGTH } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-BROADCAST";
const policy = createAuthPolicy(botToken);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55521 });
  await runMigrations(postgres.url);
  const handle = createDb(postgres.url);
  db = handle.db;
  sqlEnd = async () => {
    await handle.sql.end({ timeout: 5 });
  };
});

after(async () => {
  if (typeof sqlEnd === "function") {
    await sqlEnd();
  }
  if (postgres) {
    await postgres.stop();
  }
});

function signedInitData(telegramUserId: number): string {
  return buildSignedInitData(
    botToken,
    { id: telegramUserId, first_name: "Cast" },
    Math.floor(Date.now() / 1000),
  );
}

async function assignSuperAdmin(userId: string): Promise<void> {
  const roles = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, "super_admin"))
    .limit(1);
  assert.ok(roles[0]);
  await db.insert(adminRoleAssignments).values({
    userId,
    roleId: roles[0].id,
  });
}

async function miniToken(telegramUserId: number): Promise<{
  token: string;
  userId: string;
}> {
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/auth/telegram",
    payload: { initData: signedInitData(telegramUserId) },
  });
  const body = created.json() as { token: string; user: { userId: string } };
  await app.close();
  return { token: body.token, userId: body.user.userId };
}

async function adminToken(telegramUserId: number): Promise<{
  token: string;
  userId: string;
}> {
  const mini = await miniToken(telegramUserId);
  await assignSuperAdmin(mini.userId);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/admin/auth",
    payload: { initData: signedInitData(telegramUserId) },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as { token: string };
  await app.close();
  return { token: body.token, userId: mini.userId };
}

test("non-admin cannot create a broadcast", async () => {
  const mini = await miniToken(77001);
  const app = createApiApp({ db, authPolicy: policy });
  const denied = await app.inject({
    method: "POST",
    url: "/admin/broadcasts",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "bc-denied",
    },
    payload: { messageText: "nope" },
  });
  assert.ok(denied.statusCode === 401 || denied.statusCode === 403);
  await app.close();
});

test("admin text broadcast creates send_message jobs; duplicate key does not enqueue twice", async () => {
  const admin = await adminToken(77002);
  await miniToken(77003);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/admin/broadcasts",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "bc-text-1",
    },
    payload: { messageText: "Hello <b>all</b>" },
  });
  assert.equal(created.statusCode, 200, JSON.stringify(created.json()));
  const body = created.json() as { id: string; recipientCount: number };
  assert.ok(body.recipientCount >= 2);
  const replay = await app.inject({
    method: "POST",
    url: "/admin/broadcasts",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "bc-text-1",
    },
    payload: { messageText: "Hello <b>all</b>" },
  });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { id: string }).id, body.id);
  const sendJobs = (
    await db.select().from(jobs).where(eq(jobs.type, "telegram.send_message"))
  ).filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${body.id}:`),
  );
  assert.equal(sendJobs.length, body.recipientCount);
  await app.close();
});

test("photo and long caption split; invalid and oversized uploads are rejected", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const uploadDir = await mkdtemp(join(tmpdir(), "gb-bc-img-"));
  const admin = await adminToken(77010);
  const app = createApiApp({ db, authPolicy: policy, uploadDir });

  const badMime = await app.inject({
    method: "POST",
    url: "/admin/broadcasts/media",
    headers: { authorization: `Bearer ${admin.token}` },
    payload: {
      contentType: "image/svg+xml",
      imageBase64: Buffer.from("<svg></svg>").toString("base64"),
    },
  });
  assert.equal(badMime.statusCode, 400);

  const oversized = await app.inject({
    method: "POST",
    url: "/admin/broadcasts/media",
    headers: { authorization: `Bearer ${admin.token}` },
    payload: {
      contentType: "image/png",
      imageBase64: Buffer.alloc(5 * 1024 * 1024 + 8, 1).toString("base64"),
    },
  });
  assert.equal(oversized.statusCode, 400);

  const uploaded = await app.inject({
    method: "POST",
    url: "/admin/broadcasts/media",
    headers: { authorization: `Bearer ${admin.token}` },
    payload: {
      contentType: "image/png",
      imageBase64: PNG.toString("base64"),
    },
  });
  assert.equal(uploaded.statusCode, 200, JSON.stringify(uploaded.json()));
  const photoKey = (uploaded.json() as { photoKey: string }).photoKey;

  const photo = await app.inject({
    method: "POST",
    url: "/admin/broadcasts",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "bc-photo-1",
    },
    payload: { messageText: "with photo", photoKey },
  });
  assert.equal(photo.statusCode, 200, JSON.stringify(photo.json()));
  const photoId = (photo.json() as { id: string }).id;
  const photoJobs = (
    await db.select().from(jobs).where(eq(jobs.type, "telegram.send_photo"))
  ).filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${photoId}:`),
  );
  assert.ok(photoJobs.length >= 1);

  const split = await app.inject({
    method: "POST",
    url: "/admin/broadcasts",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "bc-photo-long",
    },
    payload: {
      messageText: "w".repeat(TELEGRAM_CAPTION_MAX_LENGTH + 4),
      photoKey,
    },
  });
  assert.equal(split.statusCode, 200, JSON.stringify(split.json()));
  const splitId = (split.json() as { id: string }).id;
  const splitPhoto = (
    await db.select().from(jobs).where(eq(jobs.type, "telegram.send_photo"))
  ).filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${splitId}:`),
  );
  const splitText = (
    await db.select().from(jobs).where(eq(jobs.type, "telegram.send_message"))
  ).filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${splitId}:`),
  );
  assert.ok(splitPhoto.length >= 1);
  assert.ok(splitText.length >= 1);

  await app.close();
  await rm(uploadDir, { recursive: true, force: true });
});

test("inactive telegram accounts are not targeted", async () => {
  const admin = await adminToken(77020);
  const extra = await miniToken(77021);
  await db
    .update(telegramAccounts)
    .set({ isActive: false })
    .where(eq(telegramAccounts.userId, extra.userId));
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/admin/broadcasts",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "bc-inactive",
    },
    payload: { messageText: "skip inactive" },
  });
  assert.equal(created.statusCode, 200);
  const id = (created.json() as { id: string }).id;
  const sendJobs = (
    await db.select().from(jobs).where(eq(jobs.type, "telegram.send_message"))
  ).filter((job) =>
    String(job.idempotencyKey).startsWith(`telegram:broadcast:${id}:`),
  );
  assert.equal(
    sendJobs.some((job) => job.idempotencyKey.endsWith(":77021")),
    false,
  );
  await app.close();
});
