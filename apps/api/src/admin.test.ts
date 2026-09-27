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
  inboundEvents,
  jobs,
  telegramAccounts,
  wallets,
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
  postgres = await startDevPostgres({ port: 55442 });
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
    { id: telegramUserId, first_name: "Admin" },
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

test("Mini App token cannot adjust a wallet", async () => {
  const mini = await miniToken(92001);
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: `/admin/users/${mini.userId}/wallet/adjust`,
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "mini-cannot-adjust",
    },
    payload: { amountMinor: "5", reason: "should fail" },
  });
  assert.equal(response.statusCode, 401);
  assert.equal((await db.select().from(walletTransactions)).length, 0);
  assert.equal((await db.select().from(auditLogs)).length, 0);
  await app.close();
});

test("GET admin views do not write", async () => {
  const admin = await adminToken(92002);
  const target = await miniToken(92003);
  const inboundBefore = (await db.select().from(inboundEvents)).length;
  const jobsBefore = (await db.select().from(jobs)).length;
  const auditBefore = (await db.select().from(auditLogs)).length;
  const walletBefore = (
    await db.select().from(wallets).where(eq(wallets.userId, target.userId))
  )[0];
  assert.ok(walletBefore);
  const app = createApiApp({ db, authPolicy: policy });
  const me = await app.inject({
    method: "GET",
    url: "/admin/me",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  const user = await app.inject({
    method: "GET",
    url: `/admin/users/${target.userId}`,
    headers: { authorization: `Bearer ${admin.token}` },
  });
  const wallet = await app.inject({
    method: "GET",
    url: `/admin/users/${target.userId}/wallet`,
    headers: { authorization: `Bearer ${admin.token}` },
  });
  const ledger = await app.inject({
    method: "GET",
    url: `/admin/users/${target.userId}/ledger`,
    headers: { authorization: `Bearer ${admin.token}` },
  });
  assert.equal(me.statusCode, 200);
  assert.deepEqual((me.json() as { roles: string[] }).roles, ["super_admin"]);
  assert.equal(user.statusCode, 200);
  assert.equal(wallet.statusCode, 200);
  assert.equal((wallet.json() as { balanceMinor: string }).balanceMinor, "0");
  assert.equal(ledger.statusCode, 200);
  assert.equal((await db.select().from(inboundEvents)).length, inboundBefore);
  assert.equal((await db.select().from(jobs)).length, jobsBefore);
  assert.equal((await db.select().from(auditLogs)).length, auditBefore);
  const walletAfter = (
    await db.select().from(wallets).where(eq(wallets.userId, target.userId))
  )[0];
  assert.equal(walletAfter?.balanceMinor, 0n);
  assert.deepEqual(walletAfter?.updatedAt, walletBefore.updatedAt);
  await app.close();
});

test("POST wallet.adjust requires reason and writes ledger plus audit", async () => {
  const admin = await adminToken(92004);
  const target = await miniToken(92005);
  const app = createApiApp({ db, authPolicy: policy });
  const missing = await app.inject({
    method: "POST",
    url: `/admin/users/${target.userId}/wallet/adjust`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "adjust-no-reason",
    },
    payload: { amountMinor: "4" },
  });
  assert.equal(missing.statusCode, 400);

  const adjusted = await app.inject({
    method: "POST",
    url: `/admin/users/${target.userId}/wallet/adjust`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "adjust-ok",
    },
    payload: { amountMinor: "4", reason: "manual credit" },
  });
  assert.equal(adjusted.statusCode, 200);
  const body = adjusted.json() as {
    balanceMinor: string;
    transactionId: string;
    auditId?: string;
  };
  assert.equal(body.balanceMinor, "4");
  assert.ok(body.auditId);

  const replay = await app.inject({
    method: "POST",
    url: `/admin/users/${target.userId}/wallet/adjust`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "adjust-ok",
    },
    payload: { amountMinor: "4", reason: "manual credit" },
  });
  assert.equal(replay.statusCode, 200);
  const txs = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, target.userId));
  const audits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.actorId, admin.userId));
  assert.equal(txs.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(txs[0]?.type, "admin_adjustment");
  assert.equal(txs[0]?.reason, "manual credit");
  await app.close();
});

test("POST wallet.adjust credits a frozen wallet", async () => {
  const admin = await adminToken(92007);
  const target = await miniToken(92008);
  await db
    .update(wallets)
    .set({ status: "frozen" })
    .where(eq(wallets.userId, target.userId));
  const app = createApiApp({ db, authPolicy: policy });
  const adjusted = await app.inject({
    method: "POST",
    url: `/admin/users/${target.userId}/wallet/adjust`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "adjust-frozen",
    },
    payload: { amountMinor: "6", reason: "unfreeze correction" },
  });
  assert.equal(adjusted.statusCode, 200);
  assert.equal((adjusted.json() as { balanceMinor: string }).balanceMinor, "6");
  const wallet = (
    await db.select().from(wallets).where(eq(wallets.userId, target.userId))
  )[0];
  assert.equal(wallet?.status, "frozen");
  assert.equal(wallet?.balanceMinor, 6n);
  await app.close();
});

test("user without admin assignment cannot open an admin session", async () => {
  const mini = await miniToken(92006);
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/admin/auth",
    payload: { initData: signedInitData(92006) },
  });
  assert.equal(response.statusCode, 403);
  const account = (
    await db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, mini.userId))
  )[0];
  assert.ok(account);
  await app.close();
});
