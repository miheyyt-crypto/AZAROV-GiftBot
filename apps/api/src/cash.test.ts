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
  inventoryItems,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApiApp } from "./app.js";

const botToken = "123456:TEST-BOT-TOKEN-CASH";
const policy = createAuthPolicy(botToken);

let postgres: DevPostgres;
let sqlEnd: () => Promise<void>;
let db: ReturnType<typeof createDb>["db"];

before(async () => {
  postgres = await startDevPostgres({ port: 55460 });
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
      first_name: "Cash",
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
    payload: { initData: signedInitData(telegramUserId, `user${telegramUserId}`) },
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
    payload: { initData: signedInitData(telegramUserId, `admin${telegramUserId}`) },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as { token: string };
  await app.close();
  return { token: body.token, userId: mini.userId };
}

async function seedCash(
  userId: string,
  amountRub: bigint,
  source = "free_case",
): Promise<string> {
  const rows = await db
    .insert(inventoryItems)
    .values({
      userId,
      itemType: "cash_rub",
      status: "available",
      amountRub,
      source,
      quantity: 1,
    })
    .returning();
  const row = rows[0];
  assert.ok(row);
  return row.id;
}

async function seedFreeze(userId: string): Promise<string> {
  const rows = await db
    .insert(inventoryItems)
    .values({
      userId,
      itemType: "streak_freeze",
      status: "available",
      quantity: 1,
      source: "shop:test",
    })
    .returning();
  const row = rows[0];
  assert.ok(row);
  return row.id;
}

test("POST /inventory/cash/:itemId/withdraw requires auth", async () => {
  const app = createApiApp({ db, authPolicy: policy });
  const response = await app.inject({
    method: "POST",
    url: "/inventory/cash/00000000-0000-4000-8000-000000000001/withdraw",
    headers: { "idempotency-key": "no-auth" },
    payload: { welvuraId: "wid" },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("user can create cash withdrawal and replay same key", async () => {
  const mini = await miniToken(97001);
  const itemId = await seedCash(mini.userId, 3000n, "medium_case");
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: `/inventory/cash/${itemId}/withdraw`,
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "cash-create-1",
    },
    payload: {
      welvuraId: "WID123",
      amountRub: "1",
      userId: "00000000-0000-4000-8000-000000000099",
      status: "fulfilled",
    },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as {
    id: string;
    amountRub: string;
    status: string;
    welvuraId: string;
    replayed: boolean;
  };
  assert.equal(body.status, "pending");
  assert.equal(body.amountRub, "3000");
  assert.equal(body.welvuraId, "WID123");
  assert.equal(body.replayed, false);

  const replay = await app.inject({
    method: "POST",
    url: `/inventory/cash/${itemId}/withdraw`,
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "cash-create-1",
    },
    payload: { welvuraId: "WID123" },
  });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { id: string }).id, body.id);
  assert.equal((replay.json() as { replayed: boolean }).replayed, true);

  const inventory = await app.inject({
    method: "GET",
    url: "/profile/inventory",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(inventory.statusCode, 200);
  const items = (
    inventory.json() as {
      items: Array<{
        id: string;
        status: string;
        activeWithdrawal: { id: string } | null;
      }>;
    }
  ).items;
  const cash = items.find((row) => row.id === itemId);
  assert.equal(cash?.status, "reserved");
  assert.equal(cash?.activeWithdrawal?.id, body.id);
  await app.close();
});

test("invalid welvura, wrong type, and not owned are mapped", async () => {
  const owner = await miniToken(97002);
  const other = await miniToken(97003);
  const itemId = await seedCash(owner.userId, 1000n);
  const freezeId = await seedFreeze(owner.userId);
  const app = createApiApp({ db, authPolicy: policy });

  const badId = await app.inject({
    method: "POST",
    url: `/inventory/cash/${itemId}/withdraw`,
    headers: {
      authorization: `Bearer ${owner.token}`,
      "idempotency-key": "cash-bad-wid",
    },
    payload: { welvuraId: "https://evil.example" },
  });
  assert.equal(badId.statusCode, 400);
  assert.equal(
    (badId.json() as { error: string }).error,
    "CASH_WITHDRAWAL_INVALID_WELVURA_ID",
  );

  const wrongType = await app.inject({
    method: "POST",
    url: `/inventory/cash/${freezeId}/withdraw`,
    headers: {
      authorization: `Bearer ${owner.token}`,
      "idempotency-key": "cash-freeze",
    },
    payload: { welvuraId: "okwid" },
  });
  assert.equal(wrongType.statusCode, 400);
  assert.equal(
    (wrongType.json() as { error: string }).error,
    "CASH_ITEM_INVALID_TYPE",
  );

  const stolen = await app.inject({
    method: "POST",
    url: `/inventory/cash/${itemId}/withdraw`,
    headers: {
      authorization: `Bearer ${other.token}`,
      "idempotency-key": "cash-steal",
    },
    payload: { welvuraId: "okwid" },
  });
  assert.equal(stolen.statusCode, 409);
  assert.equal(
    (stolen.json() as { error: string }).error,
    "CASH_ITEM_NOT_OWNED",
  );
  await app.close();
});

test("already reserved rejects a different key; users see only own history", async () => {
  const a = await miniToken(97004);
  const b = await miniToken(97005);
  const itemId = await seedCash(a.userId, 2000n);
  const app = createApiApp({ db, authPolicy: policy });
  const created = await app.inject({
    method: "POST",
    url: `/inventory/cash/${itemId}/withdraw`,
    headers: {
      authorization: `Bearer ${a.token}`,
      "idempotency-key": "cash-hist-1",
    },
    payload: { welvuraId: "histwid" },
  });
  assert.equal(created.statusCode, 200);

  const second = await app.inject({
    method: "POST",
    url: `/inventory/cash/${itemId}/withdraw`,
    headers: {
      authorization: `Bearer ${a.token}`,
      "idempotency-key": "cash-hist-2",
    },
    payload: { welvuraId: "histwid2" },
  });
  assert.equal(second.statusCode, 409);
  assert.equal(
    (second.json() as { error: string }).error,
    "CASH_ITEM_NOT_AVAILABLE",
  );

  const own = await app.inject({
    method: "GET",
    url: "/inventory/cash-withdrawals",
    headers: { authorization: `Bearer ${a.token}` },
  });
  const other = await app.inject({
    method: "GET",
    url: "/inventory/cash-withdrawals",
    headers: { authorization: `Bearer ${b.token}` },
  });
  assert.equal(own.statusCode, 200);
  assert.equal((own.json() as { items: unknown[] }).items.length, 1);
  assert.equal(other.statusCode, 200);
  assert.equal((other.json() as { items: unknown[] }).items.length, 0);
  await app.close();
});

test("normal Mini App user cannot manage cash withdrawals", async () => {
  const mini = await miniToken(97006);
  const app = createApiApp({ db, authPolicy: policy });
  const listed = await app.inject({
    method: "GET",
    url: "/admin/cash-withdrawals",
    headers: { authorization: `Bearer ${mini.token}` },
  });
  assert.equal(listed.statusCode, 401);
  const process = await app.inject({
    method: "POST",
    url: "/admin/cash-withdrawals/00000000-0000-4000-8000-000000000001/process",
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "nope",
    },
  });
  assert.equal(process.statusCode, 401);
  await app.close();
});

test("super_admin can list, process, fulfill, and reject with audit", async () => {
  const mini = await miniToken(97007);
  const admin = await adminToken(97008);
  const fulfillItem = await seedCash(mini.userId, 5000n, "blatnoy_case");
  const rejectItem = await seedCash(mini.userId, 1000n, "poor_case");
  const app = createApiApp({ db, authPolicy: policy });

  const fulfillCreated = await app.inject({
    method: "POST",
    url: `/inventory/cash/${fulfillItem}/withdraw`,
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "cash-admin-ful",
    },
    payload: { welvuraId: "adminful" },
  });
  const rejectCreated = await app.inject({
    method: "POST",
    url: `/inventory/cash/${rejectItem}/withdraw`,
    headers: {
      authorization: `Bearer ${mini.token}`,
      "idempotency-key": "cash-admin-rej",
    },
    payload: { welvuraId: "adminrej" },
  });
  const fulfillId = (fulfillCreated.json() as { id: string }).id;
  const rejectId = (rejectCreated.json() as { id: string }).id;

  const listed = await app.inject({
    method: "GET",
    url: "/admin/cash-withdrawals?status=pending",
    headers: { authorization: `Bearer ${admin.token}` },
  });
  assert.equal(listed.statusCode, 200);
  assert.ok((listed.json() as { items: unknown[] }).items.length >= 2);

  const processed = await app.inject({
    method: "POST",
    url: `/admin/cash-withdrawals/${fulfillId}/process`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "cash-admin-process",
    },
  });
  assert.equal(processed.statusCode, 200);
  assert.equal((processed.json() as { status: string }).status, "processing");

  const fulfilled = await app.inject({
    method: "POST",
    url: `/admin/cash-withdrawals/${fulfillId}/fulfill`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "cash-admin-fulfill",
    },
  });
  assert.equal(fulfilled.statusCode, 200);
  assert.equal((fulfilled.json() as { status: string }).status, "fulfilled");

  const badReject = await app.inject({
    method: "POST",
    url: `/admin/cash-withdrawals/${rejectId}/reject`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "cash-admin-reject-empty",
    },
    payload: { reason: "  " },
  });
  assert.equal(badReject.statusCode, 400);

  const rejected = await app.inject({
    method: "POST",
    url: `/admin/cash-withdrawals/${rejectId}/reject`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "cash-admin-reject",
    },
    payload: { reason: "неверный ID" },
  });
  assert.equal(rejected.statusCode, 200);
  assert.equal((rejected.json() as { status: string }).status, "rejected");

  const invalid = await app.inject({
    method: "POST",
    url: `/admin/cash-withdrawals/${fulfillId}/reject`,
    headers: {
      authorization: `Bearer ${admin.token}`,
      "idempotency-key": "cash-admin-invalid",
    },
    payload: { reason: "too late" },
  });
  assert.equal(invalid.statusCode, 400);

  const audits = await db.select().from(auditLogs);
  assert.ok(audits.some((row) => row.action === "cash_withdrawal.processing"));
  assert.ok(audits.some((row) => row.action === "cash_withdrawal.fulfilled"));
  assert.ok(audits.some((row) => row.action === "cash_withdrawal.rejected"));

  const fulfillRow = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, fulfillItem))
    .limit(1);
  const rejectRow = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, rejectItem))
    .limit(1);
  assert.equal(fulfillRow[0]?.status, "consumed");
  assert.equal(rejectRow[0]?.status, "available");
  await app.close();
});
