import {
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import {
  adminRoleAssignments,
  adminRoles,
  auditLogs,
  gramBalances,
} from "@giftbot/db/schema";
import { GRAM_MIN_WITHDRAWAL_MINOR, GRAM_MINOR_PER_UNIT } from "@giftbot/domain";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55450 });
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

function signedInitData(telegramUserId: number, username?: string): string {
  return buildSignedInitData(
    botToken,
    {
      id: telegramUserId,
      first_name: "Gram",
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

async function seedGram(userId: string, amountMinor: bigint): Promise<void> {
  await db.insert(gramBalances).values({ userId, amountMinor });
}

test("POST /gram/withdrawals requires auth", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/gram/withdrawals",
    headers: { "idempotency-key": "no-auth" },
    payload: { telegramUsername: "@user_name" },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("user cannot withdraw below the Gram minimum", async () => {
  const mini = await miniToken(95001);
  await seedGram(mini.userId, GRAM_MIN_WITHDRAWAL_MINOR - 1n);
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/gram/withdrawals",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "gram-below",
    },
    payload: { telegramUsername: "@below_min" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(
    (response.json() as { error: string }).error,
    "GRAM_WITHDRAWAL_MINIMUM_NOT_REACHED",
  );
  await app.close();
});

test("user can create a withdrawal at the exact minimum and replay the same key", async () => {
  const mini = await miniToken(95002);
  await seedGram(mini.userId, GRAM_MIN_WITHDRAWAL_MINOR);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/gram/withdrawals",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "gram-exact",
    },
    payload: { telegramUsername: "@Exact_User" },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as {
    id: string;
    amountGram: string;
    telegramUsername: string;
    status: string;
    replayed: boolean;
  };
  assert.equal(body.amountGram, "20");
  assert.equal(body.telegramUsername, "Exact_User");
  assert.equal(body.status, "pending");
  assert.equal(body.replayed, false);

  const replay = await app.inject({
    method: "POST",
    url: "/gram/withdrawals",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "gram-exact",
    },
    payload: { telegramUsername: "@Exact_User" },
  });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { id: string }).id, body.id);

  const profile = await app.inject({
    method: "GET",
    url: "/profile",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  const summary = profile.json() as {
    balances: { gram: string };
    gram: { available: string; reserved: string; canWithdraw: boolean };
  };
  assert.equal(summary.balances.gram, "0");
  assert.equal(summary.gram.available, "0");
  assert.equal(summary.gram.reserved, "20");
  assert.equal(summary.gram.canWithdraw, false);
  await app.close();
});

test("invalid telegram username is rejected without SQL details", async () => {
  const mini = await miniToken(95003);
  await seedGram(mini.userId, 25n * GRAM_MINOR_PER_UNIT);
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/gram/withdrawals",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "gram-bad-user",
    },
    payload: { telegramUsername: "https://t.me/bad" },
  });
  assert.equal(response.statusCode, 400);
  const body = response.json() as { error: string; message: string };
  assert.equal(body.error, "GRAM_INVALID_TELEGRAM_USERNAME");
  assert.doesNotMatch(body.message, /SQL|23505|postgres/i);
  await app.close();
});

test("users list only their own withdrawals", async () => {
  const first = await miniToken(95004);
  const second = await miniToken(95005);
  await seedGram(first.userId, 21n * GRAM_MINOR_PER_UNIT);
  await seedGram(second.userId, 22n * GRAM_MINOR_PER_UNIT);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/gram/withdrawals",
    headers: {
      authorization: `Bearer ${first.token}`,
      "idempotency-key": "gram-own",
    },
    payload: { telegramUsername: "owner_one" },
  });
  assert.equal(created.statusCode, 200);
  const listed = await app.inject({
    method: "GET",
    url: `/gram/withdrawals?userId=${first.userId}`,
    headers: { authorization: `Bearer ${second.token}` },
  });
  assert.equal(listed.statusCode, 200);
  const body = listed.json() as { items: Array<{ id: string }> };
  assert.equal(body.items.length, 0);
  const mine = await app.inject({
    method: "GET",
    url: "/gram/withdrawals",
    headers: { authorization: `Bearer ${first.token}` },
  });
  assert.equal((mine.json() as { items: Array<{ id: string }> }).items.length, 1);
  await app.close();
});

test("normal Mini App user cannot manage gram withdrawals", async () => {
  const mini = await miniToken(95006);
  const app = createApiApp({ db, authPolicy: policy });
  const listed = await app.inject({
    method: "GET",
    url: "/admin/gram-withdrawals",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(listed.statusCode, 401);
  const processed = await app.inject({
    method: "POST",
    url: "/admin/gram-withdrawals/00000000-0000-4000-8000-000000000001/process",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "mini-process",
    },
  });
  assert.equal(processed.statusCode, 401);
  await app.close();
});

test("super_admin can list, process, fulfill, and reject with audit", async () => {
  const admin = await adminToken(95007);
  const user = await miniToken(95008);
  await seedGram(user.userId, 23n * GRAM_MINOR_PER_UNIT);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/gram/withdrawals",
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "gram-admin-flow",
    },
    payload: { telegramUsername: "adminflow" },
  });
  assert.equal(created.statusCode, 200);
  const createdBody = created.json() as { id: string };

  const listed = await app.inject({
    method: "GET",
    url: "/admin/gram-withdrawals?status=pending",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  assert.equal(listed.statusCode, 200);
  const listBody = listed.json() as {
    items: Array<{ id: string; amountGram: string; status: string }>;
  };
  assert.ok(listBody.items.some((row) => row.id === createdBody.id));

  const processed = await app.inject({
    method: "POST",
    url: `/admin/gram-withdrawals/${createdBody.id}/process`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gram-admin-process",
    },
  });
  assert.equal(processed.statusCode, 200);
  assert.equal((processed.json() as { status: string }).status, "processing");

  const replayProcess = await app.inject({
    method: "POST",
    url: `/admin/gram-withdrawals/${createdBody.id}/process`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gram-admin-process",
    },
  });
  assert.equal(replayProcess.statusCode, 200);

  const fulfilled = await app.inject({
    method: "POST",
    url: `/admin/gram-withdrawals/${createdBody.id}/fulfill`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gram-admin-fulfill",
    },
  });
  assert.equal(fulfilled.statusCode, 200);
  assert.equal((fulfilled.json() as { status: string }).status, "fulfilled");

  const rejectAfter = await app.inject({
    method: "POST",
    url: `/admin/gram-withdrawals/${createdBody.id}/reject`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gram-admin-reject-late",
    },
    payload: { reason: "too late" },
  });
  assert.equal(rejectAfter.statusCode, 400);
  assert.equal(
    (rejectAfter.json() as { error: string }).error,
    "INVALID_TRANSITION",
  );

  const audits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, createdBody.id));
  assert.ok(audits.some((row) => row.action === "gram_withdrawal.processing"));
  assert.ok(audits.some((row) => row.action === "gram_withdrawal.fulfilled"));
  await app.close();
});

test("admin reject requires a reason and restores availability", async () => {
  const admin = await adminToken(95009);
  const user = await miniToken(95010);
  await seedGram(user.userId, 20n * GRAM_MINOR_PER_UNIT);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/gram/withdrawals",
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "gram-reject-flow",
    },
    payload: { telegramUsername: "rejectme" },
  });
  const id = (created.json() as { id: string }).id;
  const missing = await app.inject({
    method: "POST",
    url: `/admin/gram-withdrawals/${id}/reject`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gram-reject-empty",
    },
    payload: { reason: "   " },
  });
  assert.equal(missing.statusCode, 400);
  assert.equal((missing.json() as { error: string }).error, "BAD_REQUEST");

  const rejected = await app.inject({
    method: "POST",
    url: `/admin/gram-withdrawals/${id}/reject`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "gram-reject-ok",
    },
    payload: { reason: "неверный username" },
  });
  assert.equal(rejected.statusCode, 200);
  assert.equal((rejected.json() as { status: string }).status, "rejected");

  const profile = await app.inject({
    method: "GET",
    url: "/profile",
    headers: { authorization: `Bearer ${user.token}` },
  });
  const summary = profile.json() as {
    gram: { available: string; reserved: string; canWithdraw: boolean };
  };
  assert.equal(summary.gram.available, "20");
  assert.equal(summary.gram.reserved, "0");
  assert.equal(summary.gram.canWithdraw, true);

  const audits = await db.select().from(auditLogs).where(eq(auditLogs.targetId, id));
  assert.ok(
    audits.some(
      (row) =>
        row.action === "gram_withdrawal.rejected" &&
        row.reason === "неверный username",
    ),
  );
  await app.close();
});
