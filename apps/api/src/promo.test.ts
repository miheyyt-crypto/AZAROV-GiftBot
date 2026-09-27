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
  notifications,
  promoCodes,
  walletTransactions,
} from "@giftbot/db/schema";
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
  postgres = await startDevPostgres({ port: 55449 });
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

function signedInitData(telegramUserId: number): string {
  return buildSignedInitData(
    botToken,
    { id: telegramUserId, first_name: "Promo" },
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

test("POST /promo/redeem requires auth", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/promo/redeem",
    headers: { "idempotency-key": "no-auth" },
    payload: { code: "AZAROV" },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("super_admin can create, list, and deactivate promo codes with audit", async () => {
  const admin = await adminToken(94001);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: "/admin/promo-codes",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "admin-create-azarov",
    },
    payload: { code: "AZAROV", rewardAzc: "999", activationLimit: 100 },
  });
  assert.equal(created.statusCode, 200);
  const createdBody = created.json() as {
    id: string;
    code: string;
    reward: string;
    used: number;
    limit: number;
    status: string;
    auditId: string;
  };
  assert.equal(createdBody.code, "AZAROV");
  assert.equal(createdBody.reward, "999");
  assert.equal(createdBody.used, 0);
  assert.equal(createdBody.limit, 100);
  assert.equal(createdBody.status, "active");

  const duplicate = await app.inject({
    method: "POST",
    url: "/admin/promo-codes",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "admin-create-azarov-dup",
    },
    payload: { code: "azarov", rewardAzc: "1", activationLimit: 1 },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal((duplicate.json() as { error: string }).error, "PROMO_CODE_EXISTS");

  const listed = await app.inject({
    method: "GET",
    url: "/admin/promo-codes",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  assert.equal(listed.statusCode, 200);
  const listBody = listed.json() as { items: Array<{ code: string }> };
  assert.ok(listBody.items.some((row) => row.code === "AZAROV"));

  const deactivated = await app.inject({
    method: "POST",
    url: `/admin/promo-codes/${createdBody.id}/deactivate`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "admin-deactivate-azarov",
    },
  });
  assert.equal(deactivated.statusCode, 200);
  assert.equal((deactivated.json() as { status: string }).status, "inactive");

  const again = await app.inject({
    method: "POST",
    url: `/admin/promo-codes/${createdBody.id}/deactivate`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "admin-deactivate-azarov-2",
    },
  });
  assert.equal(again.statusCode, 200);
  assert.equal((again.json() as { replayed: boolean }).replayed, true);

  const audits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, createdBody.id));
  assert.ok(audits.some((row) => row.action === "promo.create"));
  assert.equal(audits.filter((row) => row.action === "promo.deactivate").length, 1);
  await app.close();
});

test("normal Mini App user cannot manage promo codes", async () => {
  const mini = await miniToken(94002);
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/admin/promo-codes",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "mini-create",
    },
    payload: { code: "NOPE", rewardAzc: "1", activationLimit: 1 },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("user redeem is authenticated, idempotent, and maps domain errors", async () => {
  const admin = await adminToken(94003);
  const user = await miniToken(94004);
  const other = await miniToken(94005);
  const app = createApiApp({ db, authPolicy: policy });

  const created = await app.inject({
    method: "POST",
    url: "/admin/promo-codes",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "admin-create-user-flow",
    },
    payload: { code: "FLOW", rewardAzc: "50", activationLimit: 1 },
  });
  assert.equal(created.statusCode, 200);
  const promoId = (created.json() as { id: string }).id;

  const missing = await app.inject({
    method: "POST",
    url: "/promo/redeem",
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "user-missing",
    },
    payload: { code: "MISSING" },
  });
  assert.equal(missing.statusCode, 404);
  assert.equal((missing.json() as { error: string }).error, "PROMO_NOT_FOUND");

  const invalid = await app.inject({
    method: "POST",
    url: "/promo/redeem",
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "user-invalid",
    },
    payload: { code: " " },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal((invalid.json() as { error: string }).error, "PROMO_INVALID_CODE");

  const success = await app.inject({
    method: "POST",
    url: "/promo/redeem",
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "user-success",
    },
    payload: { code: "flow" },
  });
  assert.equal(success.statusCode, 200);
  const successBody = success.json() as {
    status: string;
    rewardAzc: string;
    newBalanceAzc: string;
  };
  assert.equal(successBody.status, "redeemed");
  assert.equal(successBody.rewardAzc, "50");
  assert.equal(successBody.newBalanceAzc, "50");

  const replay = await app.inject({
    method: "POST",
    url: "/promo/redeem",
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "user-success",
    },
    payload: { code: "flow" },
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), successBody);

  const duplicate = await app.inject({
    method: "POST",
    url: "/promo/redeem",
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "user-success-other-key",
    },
    payload: { code: "FLOW" },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal((duplicate.json() as { error: string }).error, "PROMO_ALREADY_REDEEMED");

  const limited = await app.inject({
    method: "POST",
    url: "/promo/redeem",
    headers: {
      authorization: `Bearer ${other.token}`,
      "idempotency-key": "other-limit",
    },
    payload: { code: "FLOW" },
  });
  assert.equal(limited.statusCode, 409);
  assert.equal((limited.json() as { error: string }).error, "PROMO_LIMIT_REACHED");

  const inactivePromo = await app.inject({
    method: "POST",
    url: "/admin/promo-codes",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "admin-create-inactive",
    },
    payload: { code: "OFF", rewardAzc: "8", activationLimit: 3 },
  });
  const inactiveId = (inactivePromo.json() as { id: string }).id;
  await app.inject({
    method: "POST",
    url: `/admin/promo-codes/${inactiveId}/deactivate`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "admin-off",
    },
  });
  const inactive = await app.inject({
    method: "POST",
    url: "/promo/redeem",
    headers: {
      authorization: `Bearer ${user.token}`,
      "idempotency-key": "user-inactive",
    },
    payload: { code: "OFF" },
  });
  assert.equal(inactive.statusCode, 409);
  assert.equal((inactive.json() as { error: string }).error, "PROMO_INACTIVE");

  const credits = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(credits.length, 1);
  assert.equal(credits[0]?.type, "promo_code_reward");
  const notes = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId));
  assert.equal(notes.length, 1);
  const promo = (
    await db.select().from(promoCodes).where(eq(promoCodes.id, promoId))
  )[0];
  assert.equal(promo?.activationCount, 1);
  await app.close();
});
